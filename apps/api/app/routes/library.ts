import { Actor } from '@nestri/core/actor';
import { Examples } from '@nestri/core/examples';
import { GameDownload } from '@nestri/core/game/download';
import { Game } from '@nestri/core/game/index';
import { Identifier } from '@nestri/core/id';
import { Library } from '@nestri/core/user/library';
import { Hono } from 'hono';
import { describeRoute } from 'hono-openapi';
import { z } from 'zod';

import { ErrorResponses, adminOnly, notPublic, Result, validator } from '../utils';

export namespace LibraryApi {
	export const route = new Hono()
		.use(notPublic)
		.get(
			'/',
			describeRoute({
				tags: ['Library'],
				summary: "List the user's Steam library",
				description:
					"Returns all games in the authenticated user's library with playtime info and shared per-host download states.",
				responses: {
					200: {
						content: {
							'application/json': {
								schema: Result(
									z
										.array(
											z.object({
												id: Library.Info.shape.id,
												game: Game.Info,
												playtime2w: Library.Info.shape.playtime2w,
												playtimeForever: Library.Info.shape.playtimeForever,
												lastPlayed: Library.Info.shape.lastPlayed,
												download: GameDownload.Info.nullable()
											})
										)
										.meta({
											description: 'Library entries with game data',
											example: [Examples.Library]
										})
								)
							}
						},
						description: 'Library entries'
					},
					400: ErrorResponses[400],
					401: ErrorResponses[401]
				}
			}),
			async (c) => {
				const data = await Library.listByUserWithGames(Actor.userID);
				return c.json({ data });
			}
		)
		.post(
			'/sync',
			adminOnly,
			describeRoute({
				tags: ['Library'],
				summary: "Sync a user's Steam library",
				description:
					'Batch upsert games and library entries for a user from Steam owned games data. Admin only.',
				responses: {
					200: {
						content: {
							'application/json': {
								schema: Result(
									z.object({
										gamesSynced: z.number(),
										libraryEntries: z.number(),
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
						description: 'The user to sync library for',
						example: Examples.User.id
					}),
					games: z
						.array(
							z.object({
								steamAppId: z.number().int().meta({
									description: 'Steam application ID',
									example: Examples.Game.steamAppId
								}),
								name: z.string().meta({
									description: 'Game title',
									example: Examples.Game.name
								}),
								playtimeForever: z.number().int().optional().meta({
									description: 'Total playtime in minutes',
									example: Examples.Library.playtimeForever
								}),
								playtime2w: z.number().int().optional().meta({
									description: 'Playtime in last 2 weeks in minutes',
									example: Examples.Library.playtime2w
								}),
								rtimeLastPlayed: z.number().int().optional().meta({
									description: 'Last played unix timestamp',
									example: 1_700_000_000
								})
							})
						)
						.meta({
							description: 'Games to sync',
							example: [Examples.Game]
						})
				})
			),
			async (c) => {
				const { userId, games } = c.req.valid('json');

				const existingGames = await Game.listByAppIDs(games.map((g) => g.steamAppId));
				const existingByAppId = new Map(existingGames.map((g) => [g.steamAppId, g]));

				const failedSteamIDs = new Set<number>();
				const gamePromises = [];
				const gameIds = []; // Storing generated IDs to use in the next step

				// 1. Queue Games
				for (const g of games) {
					const existing = existingByAppId.get(g.steamAppId);
					const gameId = existing?.id ?? Identifier.ascending('game');
					gameIds.push(gameId); // Aligns with games array index

					const slug =
						g.name
							.toLowerCase()
							.replace(/[^a-z0-9]+/g, '-')
							.replace(/^-|-$/g, '') || `app-${g.steamAppId}`;

					gamePromises.push(
						Game.upsert({
							id: gameId,
							steamAppId: g.steamAppId,
							slug,
							name: g.name
						})
					);
				}

				const gameResults = await Promise.allSettled(gamePromises);
				let gamesSynced = 0;

				const libraryPromises = [];
				const librarySteamIds = []; // To track which promise belongs to which app

				// 2. Evaluate Games & Queue Libraries for Successes
				for (let i = 0; i < gameResults.length; i++) {
					const g = games[i];

					if (gameResults[i].status === 'rejected') {
						failedSteamIDs.add(g.steamAppId);
						continue; // Skip queuing library upsert if the game failed
					}

					gamesSynced++;

					const entryId = Identifier.ascending('userLibrary');
					const lastPlayed = g.rtimeLastPlayed
						? new Date(g.rtimeLastPlayed * 1000).toISOString()
						: null;

					libraryPromises.push(
						Library.upsert({
							id: entryId,
							userId,
							gameId: gameIds[i],
							playtime2w: g.playtime2w ?? null,
							playtimeForever: g.playtimeForever ?? null,
							lastPlayed
						})
					);
					librarySteamIds.push(g.steamAppId);
				}

				// 3. Execute Libraries
				const libraryResults = await Promise.allSettled(libraryPromises);
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
						failedEntries: Array.from(failedSteamIDs)
					}
				});
			}
		);
}
