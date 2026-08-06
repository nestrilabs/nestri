import { randomBytes } from 'node:crypto';

import { eq, and, isNull, sql, gt } from 'drizzle-orm';
import z from 'zod';

import { Database } from '../db/index.js';
import { Examples } from '../examples.js';
import { fn } from '../fn.js';
import { PairingCodeTable } from './pairing-code.sql.js';

function generateCode(): string {
	const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
	let code = '';
	const bytes = randomBytes(4);
	for (let i = 0; i < 4; i++) {
		code += chars[bytes[i]! % chars.length];
	}
	return `NESSH-${code}`;
}

export namespace PairingCode {
	export const Info = z
		.object({
			id: z.string().meta({
				description: 'Unique identifier for the pairing code record',
				example: Examples.PairingCode.id
			}),
			code: z.string().meta({
				description: 'Human-readable pairing code (e.g. NESSH-7F2Q)',
				example: Examples.PairingCode.code
			}),
			targetUserId: z.string().meta({
				description: 'The user who generated this code',
				example: Examples.PairingCode.targetUserId
			}),
			newFingerprint: z.string().optional().nullable().meta({
				description: 'The fingerprint that was paired (set on claim)',
				example: Examples.PairingCode.newFingerprint
			}),
			expiresAt: z.iso.datetime().meta({
				description: 'When this code expires',
				example: Examples.PairingCode.expiresAt
			}),
			claimedAt: z.iso.datetime().optional().nullable().meta({
				description: 'When this code was claimed',
				example: Examples.PairingCode.claimedAt
			}),
			isClaimed: z.boolean().meta({
				description: 'Whether this code has been used',
				example: Examples.PairingCode.isClaimed
			})
		})
		.meta({
			ref: 'PairingCode',
			description: 'Ephemeral device pairing code for linking a new SSH key to an existing user',
			example: Examples.PairingCode
		});

	export type Info = z.infer<typeof Info>;

	export const create = fn(
		Info.pick({ id: true, targetUserId: true }).extend({
			ttlMinutes: z.number().default(10)
		}),
		async (input) => {
			const code = generateCode();
			await Database.use(async (tx) => {
				await tx.insert(PairingCodeTable).values({
					id: input.id,
					code,
					targetUserId: input.targetUserId,
					expiresAt: sql`now() + interval '${sql.raw(String(input.ttlMinutes))} minutes'`,
					isClaimed: false,
					newFingerprint: null,
					claimedAt: null
				});
			});
			return code;
		}
	);

	export const claim = fn(
		Info.pick({ code: true }).extend({ fingerprint: z.string() }),
		async (input) => {
			return Database.use(async (tx) => {
				const row = await tx
					.select()
					.from(PairingCodeTable)
					.where(
						and(
							eq(PairingCodeTable.code, input.code),
							eq(PairingCodeTable.isClaimed, false),
							gt(PairingCodeTable.expiresAt, sql`now()`),
							isNull(PairingCodeTable.timeDeleted)
						)
					)
					.then((rows) => rows.at(0) ?? null);

				if (!row) {
					return null;
				}

				// `.returning()` rather than handing back the row read before
				// the update: that row still says `isClaimed: false`, so a
				// caller inspecting it would see a code that is not yet used.
				return tx
					.update(PairingCodeTable)
					.set({
						isClaimed: true,
						newFingerprint: input.fingerprint,
						claimedAt: sql`now()`
					})
					.where(eq(PairingCodeTable.id, row.id))
					.returning()
					.then((rows) => {
						const claimed = rows.at(0);
						return claimed ? serialize(claimed) : null;
					});
			});
		}
	);

	export const listByUser = fn(Info.shape.targetUserId, async (targetUserId) => {
		return Database.use(async (tx) => {
			return tx
				.select()
				.from(PairingCodeTable)
				.where(
					and(eq(PairingCodeTable.targetUserId, targetUserId), isNull(PairingCodeTable.timeDeleted))
				)
				.orderBy(PairingCodeTable.timeCreated);
		});
	});

	export const remove = fn(Info.shape.id, async (id) => {
		await Database.use(async (tx) => {
			await tx
				.update(PairingCodeTable)
				.set({ timeDeleted: sql`now()` })
				.where(eq(PairingCodeTable.id, id));
		});
	});

	export function serialize(input: typeof PairingCodeTable.$inferSelect): z.infer<typeof Info> {
		return {
			id: input.id,
			code: input.code,
			targetUserId: input.targetUserId,
			newFingerprint: input.newFingerprint,
			expiresAt: input.expiresAt.toISOString(),
			claimedAt: input.claimedAt?.toISOString() ?? null,
			isClaimed: input.isClaimed
		};
	}
}
