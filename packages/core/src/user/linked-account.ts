import { eq, and, isNull, sql } from 'drizzle-orm';
import z from 'zod';

import { Database } from '../db/index.js';
import { Examples } from '../examples.js';
import { fn } from '../fn.js';
import { LinkedAccountTable, ProviderEnum } from './linked-account.sql.js';

export namespace LinkedAccount {
	export const Info = z
		.object({
			id: z.string().meta({
				description: 'Unique identifier for the linked account record',
				example: Examples.LinkedAccount.id
			}),
			userId: z.string().meta({
				description: 'The user this account belongs to',
				example: Examples.LinkedAccount.userId
			}),
			provider: z.enum(ProviderEnum.enumValues).meta({
				description: 'Authentication provider',
				example: Examples.LinkedAccount.provider
			}),
			providerAccountId: z.string().meta({
				description: 'The account ID from the provider',
				example: Examples.LinkedAccount.providerAccountId
			}),
			profile: z.record(z.string(), z.unknown()).nullable().optional().meta({
				description: 'Platform-specific profile data (name, avatar, etc.)',
				example: Examples.LinkedAccount.profile
			})
		})
		.meta({
			ref: 'LinkedAccount',
			description: 'A linked gaming or OAuth identity (Steam, Epic Games, GitHub, Discord, etc.)',
			example: Examples.LinkedAccount
		});

	export type Info = z.infer<typeof Info>;

	export const create = fn(Info, async (input) => {
		await Database.use(async (tx) => {
			await tx.insert(LinkedAccountTable).values({
				id: input.id,
				userId: input.userId,
				provider: input.provider,
				providerAccountId: input.providerAccountId,
				profile: input.profile ?? null
			});
		});
		return input.id;
	});

	export const fromID = fn(Info.shape.id, async (id) => {
		return Database.use(async (tx) => {
			return tx
				.select()
				.from(LinkedAccountTable)
				.where(and(eq(LinkedAccountTable.id, id), isNull(LinkedAccountTable.timeDeleted)))
				.then((rows) => rows.at(0) ?? null);
		});
	});

	export const findByProvider = fn(
		Info.pick({ provider: true, providerAccountId: true }),
		async (input) => {
			return Database.use(async (tx) => {
				return tx
					.select()
					.from(LinkedAccountTable)
					.where(
						and(
							eq(LinkedAccountTable.provider, input.provider),
							eq(LinkedAccountTable.providerAccountId, input.providerAccountId),
							isNull(LinkedAccountTable.timeDeleted)
						)
					)
					.then((rows) => rows.at(0) ?? null);
			});
		}
	);

	export const findSshByFingerprint = fn(Info.shape.providerAccountId, async (fingerprint) => {
		return Database.use(async (tx) => {
			return tx
				.select()
				.from(LinkedAccountTable)
				.where(
					and(
						eq(LinkedAccountTable.provider, 'ssh'),
						eq(LinkedAccountTable.providerAccountId, fingerprint),
						isNull(LinkedAccountTable.timeDeleted)
					)
				)
				.then((rows) => rows.at(0) ?? null);
		});
	});

	export const findSteamByUser = fn(Info.shape.userId, async (userId) => {
		return Database.use(async (tx) => {
			return tx
				.select()
				.from(LinkedAccountTable)
				.where(
					and(
						eq(LinkedAccountTable.userId, userId),
						eq(LinkedAccountTable.provider, 'steam'),
						isNull(LinkedAccountTable.timeDeleted)
					)
				)
				.then((rows) => rows.at(0) ?? null);
		});
	});

	export const repoint = fn(Info.pick({ id: true, userId: true }), async (input) => {
		await Database.use(async (tx) => {
			await tx
				.update(LinkedAccountTable)
				.set({
					userId: input.userId,
					timeUpdated: sql`now()`
				})
				.where(and(eq(LinkedAccountTable.id, input.id), isNull(LinkedAccountTable.timeDeleted)));
		});
	});

	export const updateProfile = fn(Info.pick({ id: true, profile: true }), async (input) => {
		await Database.use(async (tx) => {
			await tx
				.update(LinkedAccountTable)
				.set({
					profile: input.profile ?? null,
					timeUpdated: sql`now()`
				})
				.where(and(eq(LinkedAccountTable.id, input.id), isNull(LinkedAccountTable.timeDeleted)));
		});
	});

	export const listByUser = fn(Info.shape.userId, async (userId) => {
		return Database.use(async (tx) => {
			return tx
				.select()
				.from(LinkedAccountTable)
				.where(and(eq(LinkedAccountTable.userId, userId), isNull(LinkedAccountTable.timeDeleted)))
				.orderBy(LinkedAccountTable.timeCreated);
		});
	});

	export const remove = fn(Info.shape.id, async (id) => {
		await Database.use(async (tx) => {
			await tx
				.update(LinkedAccountTable)
				.set({ timeDeleted: sql`now()` })
				.where(eq(LinkedAccountTable.id, id));
		});
	});

	export function serialize(input: typeof LinkedAccountTable.$inferSelect): z.infer<typeof Info> {
		return {
			id: input.id,
			userId: input.userId,
			provider: input.provider,
			providerAccountId: input.providerAccountId,
			profile: input.profile
		};
	}
}
