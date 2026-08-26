import { Actor } from '@nestri/core/actor';
import { ErrorCodes, VisibleError } from '@nestri/core/error';
import { Examples } from '@nestri/core/examples';
import { Depot } from '@nestri/core/game/depot';
import { GameDownload } from '@nestri/core/game/download';
import { GameDownloadStatus } from '@nestri/core/game/download.sql';
import { Game } from '@nestri/core/game/index';
import { Identifier } from '@nestri/core/id';
import { Library } from '@nestri/core/user/library';
import { Hono } from 'hono';
import { describeRoute } from 'hono-openapi';
import { z } from 'zod';

import { ErrorResponses, adminOnly, machineOrAdmin, notPublic, Result, validator } from '../utils';

const SyncGameSchema = z.object({
	steamAppId: z.number().int(),
	name: z.string(),
	aliases: z.string().optional(),
	type: z.string().optional(),
	clientIcon: z.string().optional(),
	icon: z.string().optional(),
	shortDescription: z.string().optional(),
	description: z.string().optional(),
	developers: z.array(z.string()).optional(),
	publishers: z.array(z.string()).optional(),
	primaryGenre: z.string().optional(),
	genres: z.array(z.string()).optional(),
	categories: z.array(z.string()).optional(),
	oslist: z.array(z.string()).optional(),
	sizeDownload: z.number().optional(),
	sizeOnDisk: z.number().optional(),
	controllerSupport: z.string().optional(),
	steamDeckCompat: z.string().optional(),
	reviewScorePercent: z.number().int().optional(),
	reviewCount: z.number().int().optional(),
	metacriticScore: z.number().int().optional(),
	steamChangeNumber: z.number().int().optional(),
	publicBuildId: z.number().int().optional(),
	releaseDate: z.string().optional(),
	enriched: z.boolean().default(false),
	depots: z
		.array(
			z.object({
				depotId: z.number().int(),
				branch: z.string().default('public'),
				steamManifestId: z.string().optional(),
				steamBuildId: z.number().int().optional(),
				sizeDownload: z.number().optional(),
				sizeOnDisk: z.number().optional(),
				oslist: z.string().optional()
			})
		)
		.optional()
});

const SyncLibrarySchema = z.object({
	steamAppId: z.number().int(),
	playtimeForeverMin: z.number().int().optional(),
	playtime2WeeksMin: z.number().int().optional(),
	lastPlayed: z.string().optional()
});

export namespace GameApi {
	export const route = new Hono()
		.get(
			'/',
			describeRoute({
				tags: ['Games'],
				summary: 'List games',
				description: 'List all games in the catalog, with optional search',
				responses: {
					200: {
						content: {
							'application/json': {
								schema: Result(
									z.array(Game.Info).meta({
										description: 'All games matching the optional query',
										example: [Examples.Game]
									})
								)
							}
						},
						description: 'List of games'
					},
					400: ErrorResponses[400],
					401: ErrorResponses[401]
				}
			}),
			validator(
				'query',
				z.object({
					q: z.string().optional().meta({
						description: 'Search query to filter games by name',
						example: 'Counter-Strike'
					})
				})
			),
			async (c) => {
				const { q } = c.req.valid('query');
				const games = await Game.searchByName(q ?? '');
				return c.json({ data: games });
			}
		)
		.get(
			'/:id',
			describeRoute({
				tags: ['Games'],
				summary: 'Get a game by ID',
				description: 'Retrieve a single game from the catalog',
				responses: {
					200: {
						content: {
							'application/json': {
								schema: Result(
									Game.Info.meta({
										description: 'The game',
										example: Examples.Game
									})
								)
							}
						},
						description: 'The game'
					},
					401: ErrorResponses[401],
					404: ErrorResponses[404]
				}
			}),
			validator(
				'param',
				z.object({
					id: z.string().meta({
						description: 'ID of the game',
						example: Examples.Game.id
					})
				})
			),
			async (c) => {
				const { id } = c.req.valid('param');
				const game = await Game.fromID(id);
				if (!game) {
					throw new VisibleError(
						'not_found',
						ErrorCodes.NotFound.RESOURCE_NOT_FOUND,
						`Game ${id} not found`
					);
				}
				return c.json({ data: game });
			}
		)
		.post(
			'/sync',
			notPublic,
			adminOnly,
			describeRoute({
				tags: ['Games'],
				summary: 'Batch sync games, library entries, and depots',
				description:
					'Bulk upsert games, library entries, and depot info from Steam sync. Admin only.',
				responses: {
					200: {
						content: {
							'application/json': {
								schema: Result(
									z.object({
										gamesSynced: z.number(),
										libraryEntries: z.number(),
										depotEntries: z.number(),
										failedEntries: z.array(z.number())
									})
								)
							}
						},
						description: 'Sync result'
					},
					400: ErrorResponses[400],
					401: ErrorResponses[401],
					403: ErrorResponses[403]
				}
			}),
			validator(
				'json',
				z.object({
					userId: z.string(),
					games: z.array(SyncGameSchema).default([]),
					library: z.array(SyncLibrarySchema).default([])
				})
			),
			async (c) => {
				const { userId, games, library } = c.req.valid('json');

				const existingGames = await Game.listByAppIDs(games.map((g) => g.steamAppId));
				const existingByAppId = new Map(existingGames.map((g) => [g.steamAppId, g]));
				const gameIdByAppId = new Map<number, string>();

				const failedSteamIDs = new Set<number>();
				const gamePromises = [];

				// 1. Queue Games
				for (const g of games) {
					const existing = existingByAppId.get(g.steamAppId);
					const gameId = existing?.id ?? Identifier.ascending('game');

					gameIdByAppId.set(g.steamAppId, gameId);

					const slug =
						g.name
							.toLowerCase()
							.replace(/[^a-z0-9]+/g, '-')
							.replace(/^-|-$/g, '') || `app-${g.steamAppId}`;
					const now = new Date().toISOString();
					const { enriched } = g;

					gamePromises.push(
						Game.upsert({
							id: gameId,
							steamAppId: g.steamAppId,
							slug,
							name: g.name,
							aliases: g.aliases ?? null,
							type: g.type ?? null,
							clientIcon: g.clientIcon ?? null,
							icon: g.icon ?? null,
							shortDescription: g.shortDescription ?? null,
							description: g.description ?? null,
							developers: g.developers ?? null,
							publishers: g.publishers ?? null,
							primaryGenre: g.primaryGenre ?? null,
							genres: g.genres ?? null,
							categories: g.categories ?? null,
							oslist: g.oslist ?? null,
							sizeDownload: g.sizeDownload ?? null,
							sizeOnDisk: g.sizeOnDisk ?? null,
							controllerSupport: g.controllerSupport ?? null,
							steamDeckCompat: g.steamDeckCompat ?? null,
							reviewScorePercent: g.reviewScorePercent ?? null,
							reviewCount: g.reviewCount ?? null,
							metacriticScore: g.metacriticScore ?? null,
							steamChangeNumber: g.steamChangeNumber ?? null,
							publicBuildId: g.publicBuildId ?? null,
							releaseDate: g.releaseDate ?? null,
							timeEnriched: enriched ? now : (existing?.timeEnriched?.toISOString() ?? null)
						})
					);
				}

				const gameResults = await Promise.allSettled(gamePromises);
				let gamesSynced = 0;

				const depotPromises = [];
				const depotSteamIds = [];
				const libraryPromises = [];
				const librarySteamIds = [];

				// 2. Evaluate Games & Queue Dependents
				for (let i = 0; i < gameResults.length; i++) {
					const g = games[i];

					if (gameResults[i].status === 'rejected') {
						failedSteamIDs.add(g.steamAppId);
						// Drop it from the map so the Library loop below ignores it
						gameIdByAppId.delete(g.steamAppId);
						continue;
					}

					gamesSynced++;

					if (g.depots) {
						const gameId = gameIdByAppId.get(g.steamAppId)!;
						for (const d of g.depots) {
							const depotId = Identifier.ascending('gameDepot');
							depotPromises.push(
								Depot.upsert({
									id: depotId,
									gameId: gameId,
									depotId: d.depotId,
									branch: d.branch,
									steamManifestId: d.steamManifestId ?? null,
									steamBuildId: d.steamBuildId ?? null,
									sizeDownload: d.sizeDownload ?? null,
									sizeOnDisk: d.sizeOnDisk ?? null,
									oslist: d.oslist ?? null,
									status: 'pending' as const
								})
							);
							depotSteamIds.push(g.steamAppId);
						}
					}
				}

				for (const l of library) {
					// This naturally filters out entries for games that failed in step 2
					const gameId = gameIdByAppId.get(l.steamAppId);
					if (!gameId) continue;

					const entryId = Identifier.ascending('userLibrary');
					libraryPromises.push(
						Library.upsert({
							id: entryId,
							userId,
							gameId,
							playtime2w: l.playtime2WeeksMin ?? null,
							playtimeForever: l.playtimeForeverMin ?? null,
							lastPlayed: l.lastPlayed ?? null
						})
					);
					librarySteamIds.push(l.steamAppId);
				}

				// 3. Execute Dependents in parallel
				const [depotResults, libraryResults] = await Promise.all([
					Promise.allSettled(depotPromises),
					Promise.allSettled(libraryPromises)
				]);

				let depotEntries = 0;
				for (let i = 0; i < depotResults.length; i++) {
					if (depotResults[i].status === 'rejected') {
						failedSteamIDs.add(depotSteamIds[i]);
					} else {
						depotEntries++;
					}
				}

				let libraryEntries = 0;
				for (let i = 0; i < libraryResults.length; i++) {
					if (libraryResults[i].status === 'rejected') {
						failedSteamIDs.add(librarySteamIds[i]);
					} else {
						libraryEntries++;
					}
				}

				return c.json({
					data: {
						gamesSynced,
						libraryEntries,
						depotEntries,
						failedEntries: Array.from(failedSteamIDs)
					}
				});
			}
		)
		.get(
			'/:id/download-state',
			notPublic,
			describeRoute({
				tags: ['Games'],
				summary: 'Get download states for a game',
				description:
					'Returns the per-host download states for a game. Optionally filter by hostId. Protected read route for initial/fallback data; SSH-connected clients use the live SSH snapshot.',
				responses: {
					200: {
						content: {
							'application/json': {
								schema: Result(
									z.array(GameDownload.Info).meta({
										description: 'Download states for the game',
										example: [Examples.GameDownload]
									})
								)
							}
						},
						description: 'Download states'
					},
					401: ErrorResponses[401],
					404: ErrorResponses[404]
				}
			}),
			validator(
				'param',
				z.object({
					id: z.string().meta({
						description: 'ID of the game',
						example: Examples.Game.id
					})
				})
			),
			validator(
				'query',
				z.object({
					hostId: z.string().optional().meta({
						description: 'Optional host ID to filter by',
						example: Examples.GameDownload.hostId
					})
				})
			),
			async (c) => {
				const { id } = c.req.valid('param');
				const { hostId } = c.req.valid('query');

				const game = await Game.fromID(id);
				if (!game) {
					throw new VisibleError(
						'not_found',
						ErrorCodes.NotFound.RESOURCE_NOT_FOUND,
						`Game ${id} not found`
					);
				}

				const rows = hostId
					? await GameDownload.findByHostAndGame({ hostId, gameId: id }).then((row) =>
							row ? [row] : []
						)
					: await GameDownload.listByGame(id);
				const data = rows.map((row) => GameDownload.serialize(row));
				return c.json({ data });
			}
		)
		.post(
			'/download-state',
			notPublic,
			machineOrAdmin,
			describeRoute({
				tags: ['Games'],
				summary: 'Report a download state change',
				description:
					'Update the shared per-host download state for a game. Called by nessh on terminal events (start/verifying/complete/fail). A registered host reports as itself and cannot name another; admin must supply the hostId explicitly.',
				responses: {
					200: {
						content: {
							'application/json': {
								schema: Result(
									z.object({
										downloadId: z.string(),
										download: GameDownload.Info
									})
								)
							}
						},
						description: 'Download state updated'
					},
					400: ErrorResponses[400],
					401: ErrorResponses[401],
					403: ErrorResponses[403],
					404: ErrorResponses[404]
				}
			}),
			validator(
				'json',
				z.object({
					hostId: z.string().optional().meta({
						description:
							'The nessh host reporting the download. Required for admin callers; ignored for machines, which report as themselves.',
						example: Examples.GameDownload.hostId
					}),
					steamAppId: z.number().int().meta({
						description: 'Steam application ID',
						example: Examples.Game.steamAppId
					}),
					status: z.enum(GameDownloadStatus.enumValues).meta({
						description: 'New download status',
						example: Examples.GameDownload.status
					}),
					progressBytes: z.number().int().optional().meta({
						description: 'Bytes downloaded so far',
						example: Examples.GameDownload.progressBytes
					}),
					totalBytes: z.number().int().optional().meta({
						description: 'Total bytes to download',
						example: Examples.GameDownload.totalBytes
					}),
					errorMessage: z.string().nullable().optional().meta({
						description: 'Error message if status is failed',
						example: null
					})
				})
			),
			async (c) => {
				const { hostId, steamAppId, status, progressBytes, totalBytes, errorMessage } =
					c.req.valid('json');

				// A machine reports as itself. Taking the id from the body would
				// mean any holder of a shared secret could write download state
				// under any box's id, which is the whole reason boxes register.
				const actor = Actor.use();
				let reportingHostId: string;
				if (actor.type === 'machine') {
					if (hostId && hostId !== actor.properties.machineID) {
						throw new VisibleError(
							'forbidden',
							ErrorCodes.Permission.FORBIDDEN,
							'A machine may only report its own download state'
						);
					}
					reportingHostId = actor.properties.machineID;
				} else {
					if (!hostId) {
						throw new VisibleError(
							'validation',
							ErrorCodes.Validation.MISSING_REQUIRED_FIELD,
							'hostId is required when reporting on behalf of a host',
							'hostId'
						);
					}
					reportingHostId = hostId;
				}

				const game = await Game.fromSteamAppID(steamAppId);
				if (!game) {
					throw new VisibleError(
						'not_found',
						ErrorCodes.NotFound.RESOURCE_NOT_FOUND,
						`Game with steamAppId ${steamAppId} not found`
					);
				}

				const row = await GameDownload.upsertState({
					hostId: reportingHostId,
					gameId: game.id,
					status,
					progressBytes: progressBytes ?? undefined,
					totalBytes: totalBytes ?? undefined,
					errorMessage: errorMessage ?? undefined
				});

				return c.json({
					data: { downloadId: row.id, download: GameDownload.serialize(row) }
				});
			}
		)
		.post(
			'/',
			notPublic,
			adminOnly,
			describeRoute({
				tags: ['Games'],
				summary: 'Create or update a game',
				description: 'Upsert a game by Steam app ID. Admin only.',
				responses: {
					201: {
						content: {
							'application/json': {
								schema: Result(
									Game.Info.meta({
										description: 'The created or updated game',
										example: Examples.Game
									})
								)
							}
						},
						description: 'Game created or updated'
					},
					400: ErrorResponses[400],
					401: ErrorResponses[401],
					403: ErrorResponses[403]
				}
			}),
			validator(
				'json',
				z.object({
					steamAppId: z.number().int().meta({
						description: 'Steam application ID',
						example: Examples.Game.steamAppId
					}),
					name: z.string().meta({
						description: 'Game title',
						example: Examples.Game.name
					}),
					slug: z.string().optional().meta({
						description: 'URL-friendly slug',
						example: Examples.Game.slug
					}),
					type: z.string().nullable().optional().meta({
						description: 'Content type',
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
						description: 'Short description',
						example: Examples.Game.shortDescription
					}),
					description: z.string().nullable().optional().meta({
						description: 'Full description',
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
					genres: z.array(z.string()).nullable().optional().meta({
						description: 'Game genres',
						example: Examples.Game.genres
					}),
					oslist: z.array(z.string()).nullable().optional().meta({
						description: 'Supported OS list',
						example: Examples.Game.oslist
					}),
					releaseDate: z.string().nullable().optional().meta({
						description: 'Release date ISO string',
						example: Examples.Game.releaseDate
					})
				})
			),
			async (c) => {
				const body = c.req.valid('json');
				const id = Identifier.ascending('game');
				const slug =
					body.slug ??
					body.name
						.toLowerCase()
						.replace(/[^a-z0-9]+/g, '-')
						.replace(/^-|-$/g, '');
				const game = await Game.upsert({ ...body, id, slug });
				return c.json({ data: game[0] }, 201);
			}
		);
}
