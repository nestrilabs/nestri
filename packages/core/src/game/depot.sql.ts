import { sql } from 'drizzle-orm';
import { bigint, index, integer, pgEnum, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';

import { id, timestamps, ulid } from '../db/types.js';
import { GameTable } from '../game/game.sql.js';

export const DepotStatus = pgEnum('depot_status', [
	'pending',
	'downloading',
	'complete',
	'error',
	'deleted'
]);

export const GameDepotTable = pgTable(
	'game_depot',
	{
		...id,
		...timestamps,
		gameId: ulid('game_id')
			.notNull()
			.references(() => GameTable.id, { onDelete: 'cascade' }),

		depotId: integer('depot_id').notNull(),
		branch: text('branch').notNull().default('public'),

		steamManifestId: text('steam_manifest_id'),
		steamBuildId: integer('steam_build_id'),

		installedManifestId: text('installed_manifest_id'),
		installedBuildId: integer('installed_build_id'),

		sizeDownload: bigint('size_download', { mode: 'number' }),
		sizeOnDisk: bigint('size_on_disk', { mode: 'number' }),

		status: DepotStatus('status').notNull().default('pending'),
		errorMessage: text('error_message'),

		oslist: text('oslist')
	},
	(t) => [
		uniqueIndex('game_depot_unique').on(t.gameId, t.depotId, t.branch),
		index('game_depot_game_idx').on(t.gameId),
		index('game_depot_updates_idx')
			.on(t.gameId)
			.where(sql`${t.installedManifestId} is distinct from ${t.steamManifestId}`)
	]
);
