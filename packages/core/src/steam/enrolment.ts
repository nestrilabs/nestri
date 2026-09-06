import { and, eq } from 'drizzle-orm';
import z from 'zod';

import { Database } from '../db/index.js';
import { ErrorCodes, VisibleError } from '../error.js';
import { Examples } from '../examples.js';
import { fn } from '../fn.js';
import { Identifier } from '../id.js';
import { SteamEnrolmentState, SteamEnrolmentTable } from './enrolment.sql.js';
import { STEAM_ID_RE } from './index.js';

/** A foreign key that names a row nobody has. */
function isForeignKeyViolation(err: unknown): boolean {
	const e = err as { code?: string; cause?: { code?: string } };
	return e?.code === '23503' || e?.cause?.code === '23503';
}

/**
 * What the control plane knows about a host's Steam sign-ins: that one
 * happened, for whom, and whether it is still working.
 *
 * It does not know the credential and is not able to. The auth session begins
 * on the machine that will use the token, so the token is written there and
 * stays there; what comes back here is the *outcome*. Everything in this
 * namespace is therefore a report being recorded rather than a secret being
 * stored, and the one place that is enforced is the table's column list.
 * ref(d-0004)
 *
 * This module is the sole writer of every state. A host says what happened; it
 * does not say what the record should become.
 */
export namespace Enrolment {
	export const Info = z
		.object({
			// Shaped, not merely non-empty. Both are foreign keys into
			// fixed-width columns, so a string of the wrong width is rejected
			// by the database itself — and a database refusal reaches a caller
			// as a server fault rather than as the bad input it is.
			machineId: Identifier.schema('machine').meta({
				description: 'The host that holds a token for this user',
				example: Examples.SteamEnrolment.machineId
			}),
			userId: Identifier.schema('user').meta({
				description: 'The person the host signed in as',
				example: Examples.SteamEnrolment.userId
			}),
			steamId: z.string().regex(STEAM_ID_RE, 'must be a 17-digit Steam ID').meta({
				description: 'The Steam account that was signed in',
				example: Examples.SteamEnrolment.steamId
			}),
			state: z.enum(SteamEnrolmentState.enumValues).meta({
				description:
					'`enrolled` — the host holds a working token. `stale` — Steam refused the one it holds. `revoked` — the enrolment was ended',
				example: Examples.SteamEnrolment.state
			}),
			enrolledAt: z.iso.datetime().meta({
				description: 'When this host first signed this user in. Unchanged by a re-enrolment',
				example: Examples.SteamEnrolment.enrolledAt
			}),
			lastOkAt: z.iso.datetime().nullable().meta({
				description: 'When a logon last succeeded. Nothing writes this yet, so it is null',
				example: Examples.SteamEnrolment.lastOkAt
			}),
			revokedAt: z.iso.datetime().nullable().meta({
				description: 'When the enrolment was ended',
				example: Examples.SteamEnrolment.revokedAt
			})
		})
		.meta({
			ref: 'SteamEnrolment',
			description: 'That a host holds a Steam token for a user — never the token itself',
			example: Examples.SteamEnrolment
		});

	export type Info = z.infer<typeof Info>;

	/**
	 * Record that a host completed a sign-in for a user.
	 *
	 * An upsert, because a host re-running the flow — a person signing in
	 * again, a token replaced after a refusal — is the same fact restated, not
	 * a second one. `enrolledAt` therefore survives: it says when this pairing
	 * began, and a re-enrolment does not begin it again. `revokedAt` is cleared,
	 * because a row that is `enrolled` and carries a revocation time is two
	 * answers to one question.
	 */
	export const record = fn(
		Info.pick({ machineId: true, userId: true, steamId: true }),
		async (input) => {
			return Database.use(async (tx) => {
				return tx
					.insert(SteamEnrolmentTable)
					.values({
						machineId: input.machineId,
						userId: input.userId,
						steamId: input.steamId,
						state: 'enrolled'
					})
					.onConflictDoUpdate({
						target: [SteamEnrolmentTable.machineId, SteamEnrolmentTable.userId],
						set: { steamId: input.steamId, state: 'enrolled', revokedAt: null }
					})
					.returning()
					.then((rows) => serialize(rows[0]!))
					.catch((err) => {
						if (isForeignKeyViolation(err)) {
							// A host naming a user or a machine that is not there.
							// Said plainly rather than surfacing as a server fault,
							// because the host can neither retry nor fix it.
							throw new VisibleError(
								'not_found',
								ErrorCodes.NotFound.RESOURCE_NOT_FOUND,
								'No such user or machine'
							);
						}
						throw err;
					});
			});
		}
	);

	/**
	 * Record that Steam refused the token this host holds.
	 *
	 * Scoped to the machine in the query itself, so another host's enrolment is
	 * a miss rather than a permission check somebody could forget to write.
	 * Returns null when there is nothing to mark — a host reporting a refusal
	 * for an enrolment that was never recorded is telling us something, and
	 * inventing a `stale` row to hold it would make the record say a sign-in
	 * happened that never did.
	 */
	export const markStale = fn(Info.pick({ machineId: true, userId: true }), async (input) => {
		return Database.use(async (tx) => {
			return tx
				.update(SteamEnrolmentTable)
				.set({ state: 'stale' })
				.where(
					and(
						eq(SteamEnrolmentTable.machineId, input.machineId),
						eq(SteamEnrolmentTable.userId, input.userId)
					)
				)
				.returning()
				.then((rows) => {
					const row = rows.at(0);
					return row ? serialize(row) : null;
				});
		});
	});

	/**
	 * Every enrolment the control plane believes this host has.
	 *
	 * A host that lost its disk asks this to find out what it is expected to
	 * hold, and can then say it does not. Reconciling the answer is the
	 * caller's business and nothing does it yet; the shape is fixed now so it
	 * does not have to change once something depends on it.
	 */
	export const listByMachine = fn(Info.shape.machineId, async (machineId) => {
		return Database.use(async (tx) => {
			return tx
				.select()
				.from(SteamEnrolmentTable)
				.where(eq(SteamEnrolmentTable.machineId, machineId))
				.orderBy(SteamEnrolmentTable.enrolledAt)
				.then((rows) => rows.map(serialize));
		});
	});

	export function serialize(input: typeof SteamEnrolmentTable.$inferSelect): Info {
		return {
			machineId: input.machineId,
			userId: input.userId,
			steamId: input.steamId,
			state: input.state as Info['state'],
			enrolledAt: input.enrolledAt.toISOString(),
			lastOkAt: input.lastOkAt?.toISOString() ?? null,
			revokedAt: input.revokedAt?.toISOString() ?? null
		};
	}
}
