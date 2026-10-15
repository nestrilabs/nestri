import { randomBytes } from 'node:crypto';

import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';

import { Database } from '../db/index.js';
import { ErrorCodes, VisibleError } from '../error.js';
import { fn } from '../fn.js';
import { Identifier } from '../id.js';
import { UserTable } from '../user/user.sql.js';
import { Machine } from './index.js';
import { InstallTokenTable } from './install-token.sql.js';

export namespace InstallToken {
	/** 128 bits: guessing one inside its lifetime is not a strategy. */
	const TOKEN_BYTES = 16;

	/**
	 * How long a token lives. Long enough to copy a command, open a terminal on
	 * another machine and run it; short enough that one found in shell history
	 * tomorrow is worthless.
	 */
	export const TTL_MINUTES = 60;

	/**
	 * How many one person may ask for. A token is minted by a signed-in call
	 * that a script can repeat, and each one is a host waiting to happen, so
	 * minting is bounded twice: by rate, and by how many can be lying unspent
	 * at once. Both are far above what installing by hand ever needs.
	 */
	export const HOURLY_LIMIT = 5;
	export const OUTSTANDING_LIMIT = 3;

	function generate(): string {
		return `nit_${randomBytes(TOKEN_BYTES).toString('base64url')}`;
	}

	async function digest(token: string): Promise<string> {
		const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
		return Array.from(new Uint8Array(d))
			.map((b) => b.toString(16).padStart(2, '0'))
			.join('');
	}

	/**
	 * Issue a token for a team, or for an organisation's fleet. The caller has
	 * already checked membership of whichever it names.
	 *
	 * Refused once the person has hit {@link HOURLY_LIMIT} or
	 * {@link OUTSTANDING_LIMIT}, with a message a terminal can print as it is.
	 */
	export const create = fn(
		z
			.object({
				teamId: z.string().optional(),
				organisationId: z.string().optional(),
				userId: z.string()
			})
			.refine((v) => !v.teamId !== !v.organisationId, {
				message: 'A token is for a team or for an organisation, and not both'
			}),
		async (input) => {
			const token = generate();
			const tokenHash = await digest(token);
			const expiresAt = await Database.transaction(async (tx) => {
				// The limits are counts, so they hold only if nothing else can
				// mint for this person while they are taken. Their own row is
				// the one thing every such call contends on.
				await tx
					.select({ id: UserTable.id })
					.from(UserTable)
					.where(eq(UserTable.id, input.userId))
					.for('update');
				const [usage] = await tx
					.select({
						lastHour: sql<number>`(count(*) filter (where ${InstallTokenTable.timeCreated} > now() - interval '1 hour'))::int`,
						outstanding: sql<number>`(count(*) filter (where ${InstallTokenTable.redeemedAt} is null and ${InstallTokenTable.timeDeleted} is null and ${InstallTokenTable.expiresAt} > now()))::int`
					})
					.from(InstallTokenTable)
					.where(eq(InstallTokenTable.createdByUserId, input.userId));
				if ((usage?.lastHour ?? 0) >= HOURLY_LIMIT) {
					throw new VisibleError(
						'rate_limit',
						ErrorCodes.RateLimit.TOO_MANY_REQUESTS,
						`You have made ${HOURLY_LIMIT} install tokens in the last hour. Try again later.`
					);
				}
				if ((usage?.outstanding ?? 0) >= OUTSTANDING_LIMIT) {
					throw new VisibleError(
						'rate_limit',
						ErrorCodes.RateLimit.TOO_MANY_REQUESTS,
						`You have ${OUTSTANDING_LIMIT} install tokens that have not been used yet. Use one, or wait for them to expire.`
					);
				}

				return tx
					.insert(InstallTokenTable)
					.values({
						id: Identifier.ascending('installToken'),
						teamId: input.teamId ?? null,
						organisationId: input.organisationId ?? null,
						createdByUserId: input.userId,
						tokenHash,
						expiresAt: sql`now() + interval '${sql.raw(String(TTL_MINUTES))} minutes'`
					})
					.returning({ expiresAt: InstallTokenTable.expiresAt })
					.then((rows) => rows[0]!.expiresAt);
			});
			return { token, expiresAt };
		}
	);

	/**
	 * Spend a token and register the machine it was issued for.
	 *
	 * Spending is one conditional UPDATE, so two hosts presenting the same token
	 * at the same instant cannot both win — the loser sees no row and is refused.
	 * Refusal is `null` for every reason (unknown, expired, already used), so the
	 * answer teaches a caller nothing about which tokens exist.
	 */
	export const redeem = fn(
		z.object({ token: z.string(), label: z.string().min(1).max(64) }),
		async (input) => {
			const tokenHash = await digest(input.token);
			// One transaction, so a registration that fails leaves the token
			// unspent rather than burning the only copy the person has.
			return Database.transaction(async () => {
				const spent = await Database.use(async (tx) =>
					tx
						.update(InstallTokenTable)
						.set({ redeemedAt: sql`now()` })
						.where(
							and(
								eq(InstallTokenTable.tokenHash, tokenHash),
								isNull(InstallTokenTable.redeemedAt),
								isNull(InstallTokenTable.timeDeleted),
								gt(InstallTokenTable.expiresAt, sql`now()`)
							)
						)
						.returning({
							id: InstallTokenTable.id,
							teamId: InstallTokenTable.teamId,
							organisationId: InstallTokenTable.organisationId,
							userId: InstallTokenTable.createdByUserId
						})
						.then((rows) => rows.at(0) ?? null)
				);
				if (!spent) return null;

				const machine = await Machine.register({
					id: Identifier.ascending('machine'),
					ownerUserId: spent.userId,
					teamId: spent.teamId,
					organisationId: spent.organisationId,
					label: input.label
				});

				await Database.use(async (tx) =>
					tx
						.update(InstallTokenTable)
						.set({ machineId: machine.id })
						.where(eq(InstallTokenTable.id, spent.id))
				);

				return { machineId: machine.id, slug: machine.slug, secret: machine.secret };
			});
		}
	);
}
