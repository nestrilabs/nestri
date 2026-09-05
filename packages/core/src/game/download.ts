import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import z from 'zod';

import { Database } from '../db/index.js';
import { Examples } from '../examples.js';
import { fn } from '../fn.js';
import { Identifier } from '../id.js';
import { GameDownloadStatus, GameDownloadTable } from './download.sql.js';

export namespace GameDownload {
	/**
	 * The statuses a download can be in, for callers that need the list.
	 *
	 * Re-exported from the schema so that nothing outside this module has to
	 * import a `.sql` module to spell a status. That is the layering rule
	 * everywhere here, and it also avoids a concrete hazard: a specifier
	 * ending in `.sql` is claimed by the Workers bundler as a module of its
	 * own, which emitted this file's source verbatim beside the bundle and
	 * failed at startup with an export it could not find.
	 */
	export const Status = GameDownloadStatus.enumValues;

	export const Info = z
		.object({
			id: z.string().meta({
				description: 'Unique identifier for the download state record',
				example: Examples.GameDownload.id
			}),
			hostId: z.string().meta({
				description: 'The nessh host performing the download',
				example: Examples.GameDownload.hostId
			}),
			gameId: z.string().meta({
				description: 'The game being downloaded',
				example: Examples.GameDownload.gameId
			}),
			status: z.enum(Status).meta({
				description: 'Current download status',
				example: Examples.GameDownload.status
			}),
			progressBytes: z.number().nullable().optional().meta({
				description: 'Bytes downloaded so far',
				example: Examples.GameDownload.progressBytes
			}),
			totalBytes: z.number().nullable().optional().meta({
				description: 'Total bytes to download',
				example: Examples.GameDownload.totalBytes
			}),
			timeStarted: z.string().nullable().optional().meta({
				description: 'When the download started (ISO 8601)',
				example: Examples.GameDownload.timeStarted
			}),
			timeCompleted: z.string().nullable().optional().meta({
				description: 'When the download completed (ISO 8601)',
				example: Examples.GameDownload.timeCompleted
			}),
			errorMessage: z.string().nullable().optional().meta({
				description: 'Error message if status is failed',
				example: Examples.GameDownload.errorMessage
			})
		})
		.meta({
			ref: 'GameDownload',
			description: 'Per-host game download state, shared across users',
			example: Examples.GameDownload
		});

	export type Info = z.infer<typeof Info>;

	/**
	 * Atomically insert or update the state row for a (host, game) pair and
	 * return the actual database row. Timestamps are derived from status:
	 * `downloading`/`verifying` set `timeStarted` (preserving an existing
	 * start on resume), `ready` sets `timeCompleted`.
	 */
	export const upsertState = fn(
		Info.pick({
			hostId: true,
			gameId: true,
			status: true,
			progressBytes: true,
			totalBytes: true,
			errorMessage: true
		}),
		async (input) => {
			return Database.use(async (tx) => {
				const started = input.status === 'downloading' || input.status === 'verifying';
				const [row] = await tx
					.insert(GameDownloadTable)
					.values({
						id: Identifier.ascending('gameDownload'),
						hostId: input.hostId,
						gameId: input.gameId,
						status: input.status,
						progressBytes: input.progressBytes ?? null,
						totalBytes: input.totalBytes ?? null,
						errorMessage: input.status === 'failed' ? (input.errorMessage ?? null) : null,
						timeStarted: started ? new Date() : null,
						timeCompleted: input.status === 'ready' ? new Date() : null
					})
					.onConflictDoUpdate({
						target: [GameDownloadTable.hostId, GameDownloadTable.gameId],
						set: {
							status: sql`excluded.${sql.identifier(GameDownloadTable.status.name)}`,
							progressBytes: sql`coalesce(excluded.${sql.identifier(GameDownloadTable.progressBytes.name)}, ${GameDownloadTable.progressBytes})`,
							totalBytes: sql`coalesce(excluded.${sql.identifier(GameDownloadTable.totalBytes.name)}, ${GameDownloadTable.totalBytes})`,
							errorMessage: sql`case when excluded.${sql.identifier(GameDownloadTable.status.name)} = 'failed' then coalesce(excluded.${sql.identifier(GameDownloadTable.errorMessage.name)}, ${GameDownloadTable.errorMessage}) else null end`,
							timeStarted: sql`case when excluded.${sql.identifier(GameDownloadTable.status.name)} in ('downloading', 'verifying') then coalesce(${GameDownloadTable.timeStarted}, now()) else ${GameDownloadTable.timeStarted} end`,
							timeCompleted: sql`case when excluded.${sql.identifier(GameDownloadTable.status.name)} = 'ready' then now() else null end`
						}
					})
					.returning();
				return row;
			});
		}
	);

	export const findByHostAndGame = fn(Info.pick({ hostId: true, gameId: true }), async (input) => {
		return Database.use(async (tx) => {
			return tx
				.select()
				.from(GameDownloadTable)
				.where(
					and(
						eq(GameDownloadTable.hostId, input.hostId),
						eq(GameDownloadTable.gameId, input.gameId),
						isNull(GameDownloadTable.timeDeleted)
					)
				)
				.then((rows) => rows.at(0) ?? null);
		});
	});

	export const listByGame = fn(Info.shape.gameId, async (gameId) => {
		return Database.use(async (tx) => {
			return tx
				.select()
				.from(GameDownloadTable)
				.where(and(eq(GameDownloadTable.gameId, gameId), isNull(GameDownloadTable.timeDeleted)))
				.orderBy(GameDownloadTable.timeCreated);
		});
	});

	export const listByHost = fn(Info.shape.hostId, async (hostId) => {
		return Database.use(async (tx) => {
			return tx
				.select()
				.from(GameDownloadTable)
				.where(and(eq(GameDownloadTable.hostId, hostId), isNull(GameDownloadTable.timeDeleted)))
				.orderBy(GameDownloadTable.timeCreated);
		});
	});

	export const listByGameIDs = fn(z.array(z.string()), async (gameIds) => {
		if (gameIds.length === 0) return [];
		return Database.use(async (tx) => {
			return tx
				.select()
				.from(GameDownloadTable)
				.where(
					and(inArray(GameDownloadTable.gameId, gameIds), isNull(GameDownloadTable.timeDeleted))
				);
		});
	});

	export const markReady = fn(Info.pick({ hostId: true, gameId: true }), async (input) => {
		return Database.use(async (tx) => {
			const [row] = await tx
				.update(GameDownloadTable)
				.set({ status: 'ready', timeCompleted: new Date() })
				.where(
					and(
						eq(GameDownloadTable.hostId, input.hostId),
						eq(GameDownloadTable.gameId, input.gameId),
						isNull(GameDownloadTable.timeDeleted)
					)
				)
				.returning();
			return row ?? null;
		});
	});

	export const markFailed = fn(
		Info.pick({ hostId: true, gameId: true, errorMessage: true }),
		async (input) => {
			return Database.use(async (tx) => {
				const [row] = await tx
					.update(GameDownloadTable)
					.set({
						status: 'failed',
						errorMessage: input.errorMessage ?? null
					})
					.where(
						and(
							eq(GameDownloadTable.hostId, input.hostId),
							eq(GameDownloadTable.gameId, input.gameId),
							isNull(GameDownloadTable.timeDeleted)
						)
					)
					.returning();
				return row ?? null;
			});
		}
	);

	export function serialize(input: typeof GameDownloadTable.$inferSelect): z.infer<typeof Info> {
		return {
			id: input.id,
			hostId: input.hostId,
			gameId: input.gameId,
			status: input.status as Info['status'],
			progressBytes: input.progressBytes,
			totalBytes: input.totalBytes,
			timeStarted: input.timeStarted?.toISOString() ?? null,
			timeCompleted: input.timeCompleted?.toISOString() ?? null,
			errorMessage: input.errorMessage
		};
	}
}
