import { eq, and, isNull, sql, inArray } from 'drizzle-orm';
import z from 'zod';

import { Database } from '../db/index.js';
import { Examples } from '../examples.js';
import { fn } from '../fn.js';
import { GameDownload } from './download.js';
import { GameTable } from './game.sql.js';

export { GameDownload };

export namespace Game {
	export const Info = z
		.object({
			id: z.string().meta({
				description: 'Unique identifier for the game',
				example: Examples.Game.id
			}),
			steamAppId: z.number().int().meta({
				description: 'Steam application ID',
				example: Examples.Game.steamAppId
			}),
			slug: z.string().meta({
				description: 'URL-friendly slug',
				example: Examples.Game.slug
			}),
			name: z.string().meta({
				description: 'Game title',
				example: Examples.Game.name
			}),
			type: z.string().nullable().optional().meta({
				description: 'Content type (game, dlc, demo, tool)',
				example: Examples.Game.type
			}),
			clientIcon: z.string().nullable().optional().meta({
				description: 'Steam client icon hash (256×256 square)',
				example: Examples.Game.clientIcon
			}),
			icon: z.string().nullable().optional().meta({
				description: 'Steam icon hash (32×32)',
				example: Examples.Game.icon
			}),
			shortDescription: z.string().nullable().optional().meta({
				description: 'Short marketing description',
				example: Examples.Game.shortDescription
			}),
			description: z.string().nullable().optional().meta({
				description: 'Full game description',
				example: Examples.Game.description
			}),
			developers: z.array(z.string()).nullable().optional().meta({
				description: 'Game developers',
				example: Examples.Game.developers
			}),
			publishers: z.array(z.string()).nullable().optional().meta({
				description: 'Game publishers',
				example: Examples.Game.publishers
			}),
			primaryGenre: z.string().nullable().optional().meta({
				description: 'Primary genre label',
				example: Examples.Game.primaryGenre
			}),
			genres: z.array(z.string()).nullable().optional().meta({
				description: 'All genre labels',
				example: Examples.Game.genres
			}),
			categories: z.array(z.string()).nullable().optional().meta({
				description: 'Steam store categories (Multi-player, Achievements, etc.)',
				example: Examples.Game.categories
			}),
			oslist: z.array(z.string()).nullable().optional().meta({
				description: 'Supported operating systems',
				example: Examples.Game.oslist
			}),
			sizeDownload: z.number().nullable().optional().meta({
				description: 'Compressed download size in bytes',
				example: Examples.Game.sizeDownload
			}),
			sizeOnDisk: z.number().nullable().optional().meta({
				description: 'Uncompressed install size in bytes',
				example: Examples.Game.sizeOnDisk
			}),
			controllerSupport: z.string().nullable().optional().meta({
				description: 'Controller support level',
				example: Examples.Game.controllerSupport
			}),
			steamDeckCompat: z.string().nullable().optional().meta({
				description: 'Steam Deck compatibility rating',
				example: Examples.Game.steamDeckCompat
			}),
			reviewScorePercent: z.number().int().nullable().optional().meta({
				description: 'Review score percentage (0–100)',
				example: Examples.Game.reviewScorePercent
			}),
			reviewCount: z.number().int().nullable().optional().meta({
				description: 'Total review count',
				example: Examples.Game.reviewCount
			}),
			metacriticScore: z.number().int().nullable().optional().meta({
				description: 'Metacritic score',
				example: Examples.Game.metacriticScore
			}),
			steamChangeNumber: z.number().int().nullable().optional().meta({
				description: 'PICS change number for current version',
				example: Examples.Game.steamChangeNumber
			}),
			publicBuildId: z.number().int().nullable().optional().meta({
				description: 'Public branch build ID',
				example: Examples.Game.publicBuildId
			}),
			releaseDate: z.string().nullable().optional().meta({
				description: 'Release date (ISO 8601)',
				example: Examples.Game.releaseDate
			}),
			timeEnriched: z.string().nullable().optional().meta({
				description: 'When full metadata was last enriched from PICS',
				example: Examples.Game.timeEnriched
			})
		})
		.meta({
			ref: 'Game',
			description: 'A game in the global catalog',
			example: Examples.Game
		});

	export type Info = z.infer<typeof Info>;

	export const create = fn(
		Info.pick({
			id: true,
			steamAppId: true,
			slug: true,
			name: true,
			type: true,
			clientIcon: true,
			icon: true,
			shortDescription: true,
			description: true,
			developers: true,
			publishers: true,
			primaryGenre: true,
			genres: true,
			categories: true,
			oslist: true,
			sizeDownload: true,
			sizeOnDisk: true,
			controllerSupport: true,
			steamDeckCompat: true,
			reviewScorePercent: true,
			reviewCount: true,
			metacriticScore: true,
			steamChangeNumber: true,
			publicBuildId: true,
			releaseDate: true,
			timeEnriched: true
		}),
		async (input) => {
			await Database.use(async (tx) => {
				await tx.insert(GameTable).values({
					id: input.id,
					steamAppId: input.steamAppId,
					slug: input.slug,
					name: input.name,
					type: input.type ?? null,
					clientIcon: input.clientIcon ?? null,
					icon: input.icon ?? null,
					shortDescription: input.shortDescription ?? null,
					description: input.description ?? null,
					developers: input.developers ?? null,
					publishers: input.publishers ?? null,
					primaryGenre: input.primaryGenre ?? null,
					genres: input.genres ?? null,
					categories: input.categories ?? null,
					oslist: input.oslist ?? null,
					sizeDownload: input.sizeDownload ?? null,
					sizeOnDisk: input.sizeOnDisk ?? null,
					controllerSupport: input.controllerSupport ?? null,
					steamDeckCompat: input.steamDeckCompat ?? null,
					reviewScorePercent: input.reviewScorePercent ?? null,
					reviewCount: input.reviewCount ?? null,
					metacriticScore: input.metacriticScore ?? null,
					steamChangeNumber: input.steamChangeNumber ?? null,
					publicBuildId: input.publicBuildId ?? null,
					releaseDate: input.releaseDate ? new Date(input.releaseDate) : null,
					timeEnriched: input.timeEnriched ? new Date(input.timeEnriched) : null
				});
			});
			return input.id;
		}
	);

	export const fromID = fn(Info.shape.id, async (id) => {
		return Database.use(async (tx) => {
			return tx
				.select()
				.from(GameTable)
				.where(and(eq(GameTable.id, id), isNull(GameTable.timeDeleted)))
				.then((rows) => rows.at(0) ?? null);
		});
	});

	export const fromSteamAppID = fn(z.number().int(), async (steamAppId) => {
		return Database.use(async (tx) => {
			return tx
				.select()
				.from(GameTable)
				.where(and(eq(GameTable.steamAppId, steamAppId), isNull(GameTable.timeDeleted)))
				.then((rows) => rows.at(0) ?? null);
		});
	});

	export const upsert = fn(
		Info.pick({
			id: true,
			steamAppId: true,
			slug: true,
			name: true,
			type: true,
			clientIcon: true,
			icon: true,
			shortDescription: true,
			description: true,
			developers: true,
			publishers: true,
			primaryGenre: true,
			genres: true,
			categories: true,
			oslist: true,
			sizeDownload: true,
			sizeOnDisk: true,
			controllerSupport: true,
			steamDeckCompat: true,
			reviewScorePercent: true,
			reviewCount: true,
			metacriticScore: true,
			steamChangeNumber: true,
			publicBuildId: true,
			releaseDate: true,
			timeEnriched: true
		}),
		async (input) =>
			Database.use(async (tx) =>
				tx
					.insert(GameTable)
					.values({
						id: input.id,
						steamAppId: input.steamAppId,
						slug: input.slug,
						name: input.name,
						type: input.type ?? null,
						clientIcon: input.clientIcon ?? null,
						icon: input.icon ?? null,
						shortDescription: input.shortDescription ?? null,
						description: input.description ?? null,
						developers: input.developers ?? null,
						publishers: input.publishers ?? null,
						primaryGenre: input.primaryGenre ?? null,
						genres: input.genres ?? null,
						categories: input.categories ?? null,
						oslist: input.oslist ?? null,
						sizeDownload: input.sizeDownload ?? null,
						sizeOnDisk: input.sizeOnDisk ?? null,
						controllerSupport: input.controllerSupport ?? null,
						steamDeckCompat: input.steamDeckCompat ?? null,
						reviewScorePercent: input.reviewScorePercent ?? null,
						reviewCount: input.reviewCount ?? null,
						metacriticScore: input.metacriticScore ?? null,
						steamChangeNumber: input.steamChangeNumber ?? null,
						publicBuildId: input.publicBuildId ?? null,
						releaseDate: input.releaseDate ? new Date(input.releaseDate) : null,
						timeEnriched: input.timeEnriched ? new Date(input.timeEnriched) : null
					})
					.onConflictDoUpdate({
						target: GameTable.steamAppId,
						set: {
							slug: input.slug,
							name: input.name,
							type: input.type ?? null,
							clientIcon: input.clientIcon ?? null,
							icon: input.icon ?? null,
							shortDescription: input.shortDescription ?? null,
							description: input.description ?? null,
							developers: input.developers ?? null,
							publishers: input.publishers ?? null,
							primaryGenre: input.primaryGenre ?? null,
							genres: input.genres ?? null,
							categories: input.categories ?? null,
							oslist: input.oslist ?? null,
							sizeDownload: input.sizeDownload ?? null,
							sizeOnDisk: input.sizeOnDisk ?? null,
							controllerSupport: input.controllerSupport ?? null,
							steamDeckCompat: input.steamDeckCompat ?? null,
							reviewScorePercent: input.reviewScorePercent ?? null,
							reviewCount: input.reviewCount ?? null,
							metacriticScore: input.metacriticScore ?? null,
							steamChangeNumber: input.steamChangeNumber ?? null,
							publicBuildId: input.publicBuildId ?? null,
							releaseDate: input.releaseDate ? new Date(input.releaseDate) : null,
							timeEnriched: input.timeEnriched ? new Date(input.timeEnriched) : null
						}
					})
					.returning()
			)
	);

	export const searchByName = fn(z.string(), async (query) => {
		return Database.use(async (tx) => {
			return tx
				.select()
				.from(GameTable)
				.where(
					and(isNull(GameTable.timeDeleted), sql`${GameTable.name} ILIKE ${'%' + query + '%'}`)
				)
				.orderBy(GameTable.name)
				.limit(50);
		});
	});

	export const listUnenriched = fn(z.number().int().default(50), async (limit) => {
		return Database.use(async (tx) => {
			return tx
				.select()
				.from(GameTable)
				.where(and(isNull(GameTable.timeEnriched), isNull(GameTable.timeDeleted)))
				.limit(limit);
		});
	});

	export const listByIDs = fn(z.array(z.string()), async (ids) => {
		if (ids.length === 0) return [];
		return Database.use(async (tx) => {
			return tx
				.select()
				.from(GameTable)
				.where(and(inArray(GameTable.id, ids), isNull(GameTable.timeDeleted)));
		});
	});

	export const listByAppIDs = fn(z.array(z.number().int()), async (appIds) => {
		if (appIds.length === 0) return [];
		return Database.use(async (tx) => {
			return tx
				.select()
				.from(GameTable)
				.where(and(inArray(GameTable.steamAppId, appIds), isNull(GameTable.timeDeleted)));
		});
	});

	export const remove = fn(Info.shape.id, async (id) => {
		await Database.use(async (tx) => {
			await tx
				.update(GameTable)
				.set({ timeDeleted: sql`now()` })
				.where(eq(GameTable.id, id));
		});
	});

	export function serialize(input: typeof GameTable.$inferSelect): z.infer<typeof Info> {
		return {
			id: input.id,
			steamAppId: input.steamAppId,
			slug: input.slug,
			name: input.name,
			type: input.type,
			clientIcon: input.clientIcon,
			icon: input.icon,
			shortDescription: input.shortDescription,
			description: input.description,
			developers: input.developers,
			publishers: input.publishers,
			primaryGenre: input.primaryGenre,
			genres: input.genres,
			categories: input.categories,
			oslist: input.oslist,
			sizeDownload: input.sizeDownload,
			sizeOnDisk: input.sizeOnDisk,
			controllerSupport: input.controllerSupport,
			steamDeckCompat: input.steamDeckCompat,
			reviewScorePercent: input.reviewScorePercent,
			reviewCount: input.reviewCount,
			metacriticScore: input.metacriticScore,
			steamChangeNumber: input.steamChangeNumber,
			publicBuildId: input.publicBuildId,
			releaseDate: input.releaseDate?.toISOString() ?? null,
			timeEnriched: input.timeEnriched?.toISOString() ?? null
		};
	}
}
