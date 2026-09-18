import { Actor } from '@nestri/core/actor';
import { ErrorCodes, VisibleError } from '@nestri/core/error';
import { Examples } from '@nestri/core/examples';
import { Depot } from '@nestri/core/game/depot';
import { GameDownload } from '@nestri/core/game/download';
import { Game } from '@nestri/core/game/index';
import { Identifier } from '@nestri/core/id';
import { Library } from '@nestri/core/user/library';
import { Hono } from 'hono';
import { describeRoute } from 'hono-openapi';
import { z } from 'zod';

import { enrolledUser, ErrorResponses, machineOnly, notPublic, Result, validator } from '../utils';

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
			machineOnly,
			describeRoute({
				tags: ['Games'],
				summary: 'Batch sync games, library entries, and depots',
				description:
					'Bulk upsert games, library entries and depot info from a Steam sync. Entries land in the caller\u2019s own library; there is no field for naming another user.',
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
					userId: z.string().meta({
						description: 'Which of the host\u2019s enrolled users this sync is for',
						example: Examples.User.id
					}),
					games: z.array(SyncGameSchema).default([]),
					library: z.array(SyncLibrarySchema).default([])
				})
			),
			async (c) => {
				const { games, library } = c.req.valid('json');
				const userId = await enrolledUser(c.req.valid('json').userId);

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
					'Returns the per-host download states for a game, optionally filtered to one host. This is the recorded state, written by hosts as they report progress; a client holding a live connection to a host has a fresher answer from the host itself.',
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
			machineOnly,
			describeRoute({
				tags: ['Games'],
				summary: 'Report a download state change',
				description:
					'Update the shared per-host download state for a game, on terminal events (start/verifying/complete/fail). A host reports as itself \u2014 which host it is comes from its own credentials, and there is no field that could name another.',
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
				z
					.object({
						steamAppId: z.number().int().meta({
							description: 'Steam application ID',
							example: Examples.Game.steamAppId
						}),
						status: z.enum(GameDownload.Status).meta({
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
					// A body naming a host is refused rather than ignored. It used
					// to carry one, so a caller that still sends it is saying
					// something this route no longer honours, and accepting it
					// quietly would look like it had been.
					.strict()
			),
			async (c) => {
				const { steamAppId, status, progressBytes, totalBytes, errorMessage } = c.req.valid('json');

				// A host reports as itself, and `machineOnly` is what makes that
				// the only possibility: with the id read from its credentials
				// there is no body field to disagree with them.
				const reportingHostId = Actor.machineID;

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
		);
}
