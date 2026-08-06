import { eq, and, isNull, sql, inArray } from 'drizzle-orm';
import z from 'zod';

import { Database } from '../db/index.js';
import { Examples } from '../examples.js';
import { fn } from '../fn.js';
import { GameDownload } from '../game/download.js';
import { GameDownloadTable } from '../game/download.sql.js';
import { GameTable } from '../game/game.sql.js';
import { Game } from '../game/index.js';
import { UserLibraryTable } from './library.sql.js';

export namespace Library {
	export const Info = z
		.object({
			id: z.string().meta({
				description: 'Unique identifier for the library entry',
				example: Examples.Library.id
			}),
			userId: z.string().meta({
				description: 'The user who owns this game',
				example: Examples.Library.userId
			}),
			gameId: z.string().meta({
				description: 'The game in the library',
				example: Examples.Library.gameId
			}),
			playtime2w: z.number().int().nullable().optional().meta({
				description: 'Playtime in seconds over the last 2 weeks',
				example: Examples.Library.playtime2w
			}),
			playtimeForever: z.number().int().nullable().optional().meta({
				description: 'Total playtime in seconds',
				example: Examples.Library.playtimeForever
			}),
			lastPlayed: z.string().nullable().optional().meta({
				description: 'Last time the game was played (ISO 8601)',
				example: Examples.Library.lastPlayed
			})
		})
		.meta({
			ref: 'Library',
			description: 'Links a user to a game in their library with playtime info',
			example: Examples.Library
		});

	export type Info = z.infer<typeof Info>;

	export const create = fn(Info, async (input) => {
		await Database.use(async (tx) => {
			await tx.insert(UserLibraryTable).values({
				id: input.id,
				userId: input.userId,
				gameId: input.gameId,
				playtime2w: input.playtime2w ?? null,
				playtimeForever: input.playtimeForever ?? null,
				lastPlayed: input.lastPlayed ? new Date(input.lastPlayed) : null
			});
		});
		return input.id;
	});

	export const upsert = fn(
		Info.pick({
			id: true,
			userId: true,
			gameId: true,
			playtime2w: true,
			playtimeForever: true,
			lastPlayed: true
		}),
		async (input) => {
			await Database.use(async (tx) => {
				await tx
					.insert(UserLibraryTable)
					.values({
						id: input.id,
						userId: input.userId,
						gameId: input.gameId,
						playtime2w: input.playtime2w ?? null,
						playtimeForever: input.playtimeForever ?? null,
						lastPlayed: input.lastPlayed ? new Date(input.lastPlayed) : null
					})
					.onConflictDoUpdate({
						target: [UserLibraryTable.userId, UserLibraryTable.gameId],
						set: {
							playtime2w: input.playtime2w ?? null,
							playtimeForever: input.playtimeForever ?? null,
							lastPlayed: input.lastPlayed ? new Date(input.lastPlayed) : null
						}
					});
			});
			return input.id;
		}
	);

	export const fromID = fn(Info.shape.id, async (id) => {
		return Database.use(async (tx) => {
			return tx
				.select()
				.from(UserLibraryTable)
				.where(and(eq(UserLibraryTable.id, id), isNull(UserLibraryTable.timeDeleted)))
				.then((rows) => rows.at(0) ?? null);
		});
	});

	export const findByUserAndGame = fn(Info.pick({ userId: true, gameId: true }), async (input) => {
		return Database.use(async (tx) => {
			return tx
				.select()
				.from(UserLibraryTable)
				.where(
					and(
						eq(UserLibraryTable.userId, input.userId),
						eq(UserLibraryTable.gameId, input.gameId),
						isNull(UserLibraryTable.timeDeleted)
					)
				)
				.then((rows) => rows.at(0) ?? null);
		});
	});

	export const listByUser = fn(Info.shape.userId, async (userId) => {
		return Database.use(async (tx) => {
			return tx
				.select()
				.from(UserLibraryTable)
				.where(and(eq(UserLibraryTable.userId, userId), isNull(UserLibraryTable.timeDeleted)))
				.orderBy(UserLibraryTable.timeCreated);
		});
	});

	export const listByUserWithGames = fn(Info.shape.userId, async (userId) => {
		return Database.use(async (tx) => {
			const rows = await tx
				.select({
					library: UserLibraryTable,
					game: GameTable
				})
				.from(UserLibraryTable)
				.leftJoin(GameTable, eq(UserLibraryTable.gameId, GameTable.id))
				.where(and(eq(UserLibraryTable.userId, userId), isNull(UserLibraryTable.timeDeleted)))
				.orderBy(UserLibraryTable.timeCreated);

			const gameIds = [
				...new Set(rows.filter((row) => row.game !== null).map((row) => row.library.gameId))
			];
			const downloadRows =
				gameIds.length > 0
					? await tx
							.select()
							.from(GameDownloadTable)
							.where(
								and(
									inArray(GameDownloadTable.gameId, gameIds),
									isNull(GameDownloadTable.timeDeleted)
								)
							)
					: [];

			// A game may have one state row per host; surface the most recently
			// updated state for the library listing.
			const downloadByGame = new Map<string, (typeof downloadRows)[number]>();
			for (const row of downloadRows) {
				const existing = downloadByGame.get(row.gameId);
				if (!existing || row.timeUpdated > existing.timeUpdated) {
					downloadByGame.set(row.gameId, row);
				}
			}

			return rows
				.filter((row) => row.game !== null)
				.map((row) => {
					const download = downloadByGame.get(row.library.gameId);
					return {
						id: row.library.id,
						game: Game.serialize(row.game!),
						playtime2w: row.library.playtime2w,
						playtimeForever: row.library.playtimeForever,
						lastPlayed: row.library.lastPlayed?.toISOString() ?? null,
						download: download ? GameDownload.serialize(download) : null
					};
				});
		});
	});

	export const listByGame = fn(Info.shape.gameId, async (gameId) => {
		return Database.use(async (tx) => {
			return tx
				.select()
				.from(UserLibraryTable)
				.where(and(eq(UserLibraryTable.gameId, gameId), isNull(UserLibraryTable.timeDeleted)));
		});
	});

	export const listByUserAndGameIDs = fn(
		z.object({ userId: z.string(), gameIds: z.array(z.string()) }),
		async (input) => {
			if (input.gameIds.length === 0) return [];
			return Database.use(async (tx) => {
				return tx
					.select()
					.from(UserLibraryTable)
					.where(
						and(
							eq(UserLibraryTable.userId, input.userId),
							inArray(UserLibraryTable.gameId, input.gameIds),
							isNull(UserLibraryTable.timeDeleted)
						)
					);
			});
		}
	);

	export const remove = fn(Info.shape.id, async (id) => {
		await Database.use(async (tx) => {
			await tx
				.update(UserLibraryTable)
				.set({ timeDeleted: sql`now()` })
				.where(eq(UserLibraryTable.id, id));
		});
	});

	export function serialize(input: typeof UserLibraryTable.$inferSelect): z.infer<typeof Info> {
		return {
			id: input.id,
			userId: input.userId,
			gameId: input.gameId,
			playtime2w: input.playtime2w,
			playtimeForever: input.playtimeForever,
			lastPlayed: input.lastPlayed?.toISOString() ?? null
		};
	}
}
