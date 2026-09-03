import { bigint, index, pgEnum, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';

import { id, timestamps, ulid, utc } from '../db/types.js';
import { MachineTable } from '../machine/machine.sql.js';
import { GameTable } from './game.sql.js';

export const GameDownloadStatus = pgEnum('game_download_status', [
	'pending',
	'verifying',
	'downloading',
	'ready',
	'failed'
]);

export const GameDownloadTable = pgTable(
	'game_download',
	{
		...id,
		...timestamps,
		// A foreign key since 0048. It was a bare `text` column — the one place a
		// host was referred to by a string nothing checked — so a typo produced
		// a download row belonging to a machine that had never existed.
		hostId: ulid('host_id')
			.notNull()
			.references(() => MachineTable.id, { onDelete: 'cascade' }),
		gameId: ulid('game_id')
			.notNull()
			.references(() => GameTable.id, { onDelete: 'cascade' }),

		status: GameDownloadStatus('status').notNull().default('pending'),

		progressBytes: bigint('progress_bytes', { mode: 'number' }).default(0),
		totalBytes: bigint('total_bytes', { mode: 'number' }),

		timeStarted: utc('time_started'),
		timeCompleted: utc('time_completed'),
		errorMessage: text('error_message')
	},
	(t) => [
		uniqueIndex('game_download_host_game_unique').on(t.hostId, t.gameId),
		index('game_download_game_idx').on(t.gameId),
		index('game_download_host_status_idx').on(t.hostId, t.status)
	]
);
