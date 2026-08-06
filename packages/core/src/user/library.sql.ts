import { index, integer, pgTable, uniqueIndex } from 'drizzle-orm/pg-core';

import { id, timestamps, ulid, utc } from '../db/types.js';
import { GameTable } from '../game/game.sql.js';
import { UserTable } from '../user/user.sql.js';

export const UserLibraryTable = pgTable(
	'user_library',
	{
		...id,
		...timestamps,
		userId: ulid('user_id')
			.notNull()
			.references(() => UserTable.id, { onDelete: 'cascade' }),
		gameId: ulid('game_id')
			.notNull()
			.references(() => GameTable.id, { onDelete: 'cascade' }),
		playtime2w: integer('playtime_2w'),
		playtimeForever: integer('playtime_forever'),
		lastPlayed: utc('last_played')
	},
	(t) => [
		uniqueIndex('user_library_user_game_unique').on(t.userId, t.gameId),
		index('user_library_user_idx').on(t.userId),
		index('user_library_game_idx').on(t.gameId)
	]
);
