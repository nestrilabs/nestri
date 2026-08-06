import { eq, and, isNull, sql, inArray } from 'drizzle-orm';
import z from 'zod';

import { Database } from '../db/index.js';
import { Examples } from '../examples.js';
import { fn } from '../fn.js';
import { DepotStatus, GameDepotTable } from './depot.sql.js';

export namespace Depot {
	export const Info = z
		.object({
			id: z.string().meta({
				description: 'Unique identifier for the depot entry',
				example: Examples.Depot.id
			}),
			gameId: z.string().meta({
				description: 'The game this depot belongs to',
				example: Examples.Depot.gameId
			}),
			depotId: z.number().int().meta({
				description: 'Steam depot ID',
				example: Examples.Depot.depotId
			}),
			branch: z.string().meta({
				description: 'Depot branch (e.g. public)',
				example: Examples.Depot.branch
			}),
			steamManifestId: z.string().nullable().optional().meta({
				description: 'Current manifest ID from Steam',
				example: Examples.Depot.steamManifestId
			}),
			steamBuildId: z.number().int().nullable().optional().meta({
				description: 'Current build ID from Steam',
				example: Examples.Depot.steamBuildId
			}),
			installedManifestId: z.string().nullable().optional().meta({
				description: 'Installed manifest ID on this host',
				example: Examples.Depot.installedManifestId
			}),
			installedBuildId: z.number().int().nullable().optional().meta({
				description: 'Installed build ID on this host',
				example: Examples.Depot.installedBuildId
			}),
			sizeDownload: z.number().nullable().optional().meta({
				description: 'Compressed download size in bytes',
				example: Examples.Depot.sizeDownload
			}),
			sizeOnDisk: z.number().nullable().optional().meta({
				description: 'Uncompressed size in bytes',
				example: Examples.Depot.sizeOnDisk
			}),
			status: z.enum(DepotStatus.enumValues).meta({
				description: 'Current depot status',
				example: Examples.Depot.status
			}),
			errorMessage: z.string().nullable().optional().meta({
				description: 'Error message if status is error',
				example: Examples.Depot.errorMessage
			}),
			oslist: z.string().nullable().optional().meta({
				description: 'OS filter (windows, linux, mac)',
				example: Examples.Depot.oslist
			})
		})
		.meta({
			ref: 'Depot',
			description: 'A game depot (shared install/update tracking)',
			example: Examples.Depot
		});

	export type Info = z.infer<typeof Info>;

	export const create = fn(
		Info.pick({
			id: true,
			gameId: true,
			depotId: true,
			branch: true,
			steamManifestId: true,
			steamBuildId: true,
			installedManifestId: true,
			installedBuildId: true,
			sizeDownload: true,
			sizeOnDisk: true,
			status: true,
			errorMessage: true,
			oslist: true
		}),
		async (input) => {
			await Database.use(async (tx) => {
				await tx.insert(GameDepotTable).values({
					id: input.id,
					gameId: input.gameId,
					depotId: input.depotId,
					branch: input.branch ?? 'public',
					steamManifestId: input.steamManifestId ?? null,
					steamBuildId: input.steamBuildId ?? null,
					installedManifestId: input.installedManifestId ?? null,
					installedBuildId: input.installedBuildId ?? null,
					sizeDownload: input.sizeDownload ?? null,
					sizeOnDisk: input.sizeOnDisk ?? null,
					status: input.status ?? 'pending',
					errorMessage: input.errorMessage ?? null,
					oslist: input.oslist ?? null
				});
			});
			return input.id;
		}
	);

	export const upsert = fn(
		Info.pick({
			id: true,
			gameId: true,
			depotId: true,
			branch: true,
			steamManifestId: true,
			steamBuildId: true,
			installedManifestId: true,
			installedBuildId: true,
			sizeDownload: true,
			sizeOnDisk: true,
			status: true,
			errorMessage: true,
			oslist: true
		}),
		async (input) => {
			await Database.use(async (tx) => {
				await tx
					.insert(GameDepotTable)
					.values({
						id: input.id,
						gameId: input.gameId,
						depotId: input.depotId,
						branch: input.branch ?? 'public',
						steamManifestId: input.steamManifestId ?? null,
						steamBuildId: input.steamBuildId ?? null,
						installedManifestId: input.installedManifestId ?? null,
						installedBuildId: input.installedBuildId ?? null,
						sizeDownload: input.sizeDownload ?? null,
						sizeOnDisk: input.sizeOnDisk ?? null,
						status: input.status ?? 'pending',
						errorMessage: input.errorMessage ?? null,
						oslist: input.oslist ?? null
					})
					.onConflictDoUpdate({
						target: [GameDepotTable.gameId, GameDepotTable.depotId, GameDepotTable.branch],
						set: {
							steamManifestId: sql`excluded.${GameDepotTable.steamManifestId.name}`,
							steamBuildId: sql`excluded.${GameDepotTable.steamBuildId.name}`,
							sizeDownload: sql`excluded.${GameDepotTable.sizeDownload.name}`,
							sizeOnDisk: sql`excluded.${GameDepotTable.sizeOnDisk.name}`,
							oslist: sql`excluded.${GameDepotTable.oslist.name}`
							// Do not clobber installed_* fields — those are set by DepotJob
						}
					});
			});
			return input.id;
		}
	);

	export const markInstalled = fn(
		Info.pick({ id: true, installedManifestId: true, installedBuildId: true, status: true }),
		async (input) => {
			await Database.use(async (tx) => {
				await tx
					.update(GameDepotTable)
					.set({
						installedManifestId: input.installedManifestId,
						installedBuildId: input.installedBuildId,
						status: input.status ?? 'complete'
					})
					.where(eq(GameDepotTable.id, input.id));
			});
		}
	);

	export const fromID = fn(Info.shape.id, async (id) => {
		return Database.use(async (tx) => {
			return tx
				.select()
				.from(GameDepotTable)
				.where(and(eq(GameDepotTable.id, id), isNull(GameDepotTable.timeDeleted)))
				.then((rows) => rows.at(0) ?? null);
		});
	});

	export const listByGame = fn(Info.shape.gameId, async (gameId) => {
		return Database.use(async (tx) => {
			return tx
				.select()
				.from(GameDepotTable)
				.where(and(eq(GameDepotTable.gameId, gameId), isNull(GameDepotTable.timeDeleted)));
		});
	});

	export const listByGameIDs = fn(z.array(z.string()), async (gameIds) => {
		if (gameIds.length === 0) return [];
		return Database.use(async (tx) => {
			return tx
				.select()
				.from(GameDepotTable)
				.where(and(inArray(GameDepotTable.gameId, gameIds), isNull(GameDepotTable.timeDeleted)));
		});
	});

	export const listByGameAndDepotIDs = fn(
		z.object({ gameIds: z.array(z.string()), depotIds: z.array(z.number().int()) }),
		async (input) => {
			if (input.gameIds.length === 0 || input.depotIds.length === 0) return [];
			return Database.use(async (tx) => {
				return tx
					.select()
					.from(GameDepotTable)
					.where(
						and(
							inArray(GameDepotTable.gameId, input.gameIds),
							inArray(GameDepotTable.depotId, input.depotIds),
							isNull(GameDepotTable.timeDeleted)
						)
					);
			});
		}
	);

	export const getInstalled = fn(z.void(), async () => {
		return Database.use(async (tx) => {
			return tx
				.select()
				.from(GameDepotTable)
				.where(
					and(
						isNull(GameDepotTable.timeDeleted),
						sql`${GameDepotTable.installedManifestId} IS NOT NULL`
					)
				);
		});
	});

	export const remove = fn(Info.shape.id, async (id) => {
		await Database.use(async (tx) => {
			await tx
				.update(GameDepotTable)
				.set({ timeDeleted: sql`now()` })
				.where(eq(GameDepotTable.id, id));
		});
	});

	export function serialize(input: typeof GameDepotTable.$inferSelect): z.infer<typeof Info> {
		return {
			id: input.id,
			gameId: input.gameId,
			depotId: input.depotId,
			branch: input.branch,
			steamManifestId: input.steamManifestId,
			steamBuildId: input.steamBuildId,
			installedManifestId: input.installedManifestId,
			installedBuildId: input.installedBuildId,
			sizeDownload: input.sizeDownload,
			sizeOnDisk: input.sizeOnDisk,
			status: input.status as Info['status'],
			errorMessage: input.errorMessage,
			oslist: input.oslist
		};
	}
}
