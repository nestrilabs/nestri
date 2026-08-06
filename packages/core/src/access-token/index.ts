import { randomBytes } from 'node:crypto';

import { and, eq, isNull, sql } from 'drizzle-orm';
import z from 'zod';

import { Database } from '../db/index.js';
import { Examples } from '../examples.js';
import { fn } from '../fn.js';
import { AccessTokenTable } from './access-token.sql.js';

/**
 * Personal access tokens.
 *
 * The prefix is load-bearing: the API decides how to verify a bearer token by
 * looking at it, so a PAT never reaches JWT verification and a JWT never
 * reaches a database lookup. Without it every request would pay for both.
 */
export namespace AccessToken {
	export const PREFIX = 'pat_';

	const SECRET_BYTES = 32;

	export const Info = z
		.object({
			id: z.string().meta({
				description: 'Unique identifier for the token record',
				example: Examples.AccessToken.id
			}),
			ownerUserId: z.string().meta({
				description: 'The user this token acts as',
				example: Examples.AccessToken.ownerUserId
			}),
			teamId: z.string().optional().nullable().meta({
				description: 'Team this token acts within, when it is team-scoped',
				example: Examples.AccessToken.teamId
			}),
			name: z.string().meta({
				description: 'What the token is for, so it can be recognised later',
				example: Examples.AccessToken.name
			}),
			expiresAt: z.iso.datetime().optional().nullable().meta({
				description: 'When the token stops working. Null means it does not expire.',
				example: Examples.AccessToken.expiresAt
			}),
			lastUsed: z.iso.datetime().optional().nullable().meta({
				description: 'When the token was last accepted',
				example: Examples.AccessToken.lastUsed
			})
		})
		.meta({
			ref: 'AccessToken',
			description: 'A long-lived, revocable credential for non-browser access',
			example: Examples.AccessToken
		});

	export type Info = z.infer<typeof Info>;

	function generateToken(): string {
		return `${PREFIX}${randomBytes(SECRET_BYTES).toString('base64url')}`;
	}

	async function hashToken(token: string): Promise<string> {
		const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
		return Array.from(new Uint8Array(digest))
			.map((b) => b.toString(16).padStart(2, '0'))
			.join('');
	}

	/** Cheap check that routes a bearer token to the right verifier. */
	export function looksLikeToken(bearer: string): boolean {
		return bearer.startsWith(PREFIX);
	}

	/**
	 * Mint a token. The value is returned here and nowhere else — only its
	 * digest is stored, so a lost token is replaced rather than recovered.
	 */
	export const create = fn(
		Info.pick({ id: true, ownerUserId: true, teamId: true, name: true }).extend({
			expiresInDays: z.number().int().min(1).optional()
		}),
		async (input) => {
			const token = generateToken();
			await Database.use(async (tx) => {
				await tx.insert(AccessTokenTable).values({
					id: input.id,
					ownerUserId: input.ownerUserId,
					teamId: input.teamId ?? null,
					name: input.name,
					tokenHash: await hashToken(token),
					expiresAt: input.expiresInDays
						? sql`now() + interval '${sql.raw(String(input.expiresInDays))} days'`
						: null,
					lastUsed: null
				});
			});
			return { id: input.id, token };
		}
	);

	/**
	 * Resolve a token to its record, or `null`.
	 *
	 * Expiry is part of the query rather than a check afterwards: an expired
	 * token and an unknown one are then indistinguishable to the caller, and
	 * there is no branch left where a stale row could be accepted by mistake.
	 */
	export const authenticate = fn(z.string(), async (token) => {
		if (!looksLikeToken(token)) {
			return null;
		}
		const tokenHash = await hashToken(token);
		return Database.use(async (tx) => {
			return tx
				.select()
				.from(AccessTokenTable)
				.where(
					and(
						eq(AccessTokenTable.tokenHash, tokenHash),
						isNull(AccessTokenTable.timeDeleted),
						sql`(${AccessTokenTable.expiresAt} is null or ${AccessTokenTable.expiresAt} > now())`
					)
				)
				.then((rows) => {
					const row = rows.at(0);
					// Serialized here so `tokenHash` never leaves this function.
					return row ? serialize(row) : null;
				});
		});
	});

	export const touchLastUsed = fn(Info.shape.id, async (id) => {
		await Database.use(async (tx) => {
			await tx
				.update(AccessTokenTable)
				.set({ lastUsed: sql`now()` })
				.where(eq(AccessTokenTable.id, id));
		});
	});

	export const listByOwner = fn(Info.shape.ownerUserId, async (ownerUserId) => {
		return Database.use(async (tx) => {
			return tx
				.select()
				.from(AccessTokenTable)
				.where(
					and(eq(AccessTokenTable.ownerUserId, ownerUserId), isNull(AccessTokenTable.timeDeleted))
				)
				.orderBy(AccessTokenTable.timeCreated)
				.then((rows) => rows.map(serialize));
		});
	});

	/** Revoke by id, but only for its owner — ids are guessable in shape. */
	export const revoke = fn(Info.pick({ id: true, ownerUserId: true }), async (input) => {
		return Database.use(async (tx) => {
			return tx
				.update(AccessTokenTable)
				.set({ timeDeleted: sql`now()` })
				.where(
					and(
						eq(AccessTokenTable.id, input.id),
						eq(AccessTokenTable.ownerUserId, input.ownerUserId),
						isNull(AccessTokenTable.timeDeleted)
					)
				)
				.returning()
				.then((rows) => {
					const row = rows.at(0);
					return row ? serialize(row) : null;
				});
		});
	});

	export function serialize(input: typeof AccessTokenTable.$inferSelect): z.infer<typeof Info> {
		return {
			id: input.id,
			ownerUserId: input.ownerUserId,
			teamId: input.teamId,
			name: input.name,
			expiresAt: input.expiresAt?.toISOString() ?? null,
			lastUsed: input.lastUsed?.toISOString() ?? null
		};
	}
}
