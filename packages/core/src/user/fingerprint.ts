import { eq, and, isNull, sql } from 'drizzle-orm';
import z from 'zod';

import { Database } from '../db/index.js';
import { Examples } from '../examples.js';
import { fn } from '../fn.js';
import { UserFingerprintTable } from './fingerprint.sql.js';
import { User } from './index.js';
import { LinkedAccount } from './linked-account.js';

export namespace Fingerprint {
	export const Info = z
		.object({
			id: z.string().meta({
				description: 'Unique identifier for the fingerprint record',
				example: Examples.Fingerprint.id
			}),
			userId: z.string().meta({
				description: 'The user this fingerprint belongs to',
				example: Examples.Fingerprint.userId
			}),
			fingerprint: z.string().meta({
				description: 'MD5 hex of the SSH public key',
				example: Examples.Fingerprint.fingerprint
			}),
			name: z.string().optional().nullable().meta({
				description: 'Human-readable label (e.g. "MacBook Air")',
				example: Examples.Fingerprint.name
			}),
			lastSeen: z.iso.datetime().optional().nullable().meta({
				description: 'Timestamp of last connection using this key',
				example: Examples.Fingerprint.lastSeen
			})
		})
		.meta({
			ref: 'Fingerprint',
			description: 'An SSH public key fingerprint linked to a user account',
			example: Examples.Fingerprint
		});

	export type Info = z.infer<typeof Info>;

	export const create = fn(
		Info.pick({ id: true, userId: true, fingerprint: true, name: true }),
		async (input) => {
			await Database.use(async (tx) => {
				await tx.insert(UserFingerprintTable).values({
					id: input.id,
					userId: input.userId,
					fingerprint: input.fingerprint,
					name: input.name ?? null,
					lastSeen: null
				});
			});
			return input.id;
		}
	);

	export const fromID = fn(Info.shape.id, async (id) => {
		return Database.use(async (tx) => {
			return tx
				.select()
				.from(UserFingerprintTable)
				.where(and(eq(UserFingerprintTable.id, id), isNull(UserFingerprintTable.timeDeleted)))
				.then((rows) => rows.at(0) ?? null);
		});
	});

	export const findByFingerprint = fn(Info.shape.fingerprint, async (fingerprint) => {
		return Database.use(async (tx) => {
			return tx
				.select()
				.from(UserFingerprintTable)
				.where(
					and(
						eq(UserFingerprintTable.fingerprint, fingerprint),
						isNull(UserFingerprintTable.timeDeleted)
					)
				)
				.then((rows) => rows.at(0) ?? null);
		});
	});

	export const listByUser = fn(Info.shape.userId, async (userId) => {
		return Database.use(async (tx) => {
			return tx
				.select()
				.from(UserFingerprintTable)
				.where(
					and(eq(UserFingerprintTable.userId, userId), isNull(UserFingerprintTable.timeDeleted))
				)
				.orderBy(UserFingerprintTable.timeCreated);
		});
	});

	export const updateName = fn(Info.pick({ id: true, name: true }), async (input) => {
		await Database.use(async (tx) => {
			await tx
				.update(UserFingerprintTable)
				.set({ name: input.name ?? null })
				.where(eq(UserFingerprintTable.id, input.id));
		});
	});

	export const touchLastSeen = fn(Info.shape.id, async (id) => {
		await Database.use(async (tx) => {
			await tx
				.update(UserFingerprintTable)
				.set({ lastSeen: sql`now()` })
				.where(eq(UserFingerprintTable.id, id));
		});
	});

	export const remove = fn(Info.shape.fingerprint, async (fingerprint) => {
		await Database.use(async (tx) => {
			await tx
				.update(UserFingerprintTable)
				.set({ timeDeleted: sql`now()` })
				.where(eq(UserFingerprintTable.fingerprint, fingerprint));
		});
	});

	export const repoint = fn(Info.pick({ fingerprint: true, userId: true }), async (input) => {
		await Database.use(async (tx) => {
			await tx
				.update(UserFingerprintTable)
				.set({
					userId: input.userId,
					timeUpdated: sql`now()`
				})
				.where(
					and(
						eq(UserFingerprintTable.fingerprint, input.fingerprint),
						isNull(UserFingerprintTable.timeDeleted)
					)
				);
		});
	});

	export const mergeFingerprint = fn(
		Info.pick({ fingerprint: true }).extend({ targetUserId: z.string() }),
		async (input) => {
			const fp = await findByFingerprint(input.fingerprint);
			if (!fp) {
				throw new Error('Fingerprint not found');
			}

			if (fp.userId === input.targetUserId) {
				return { merged: false as const, reason: 'already_owned' as const };
			}

			const orphanLinkedAccounts = await LinkedAccount.listByUser(fp.userId);
			if (orphanLinkedAccounts.length > 0) {
				throw new Error(
					'This device already has linked accounts. Unlink them first before merging.'
				);
			}

			await Database.transaction(async () => {
				await repoint({ fingerprint: input.fingerprint, userId: input.targetUserId });
				await User.remove(fp.userId);
			});

			return { merged: true as const, targetUserId: input.targetUserId };
		}
	);

	export function serialize(input: typeof UserFingerprintTable.$inferSelect): z.infer<typeof Info> {
		return {
			id: input.id,
			userId: input.userId,
			fingerprint: input.fingerprint,
			name: input.name,
			lastSeen: input.lastSeen?.toISOString() ?? null
		};
	}
}
