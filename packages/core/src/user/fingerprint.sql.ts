import { index, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';

import { id, timestamps, ulid, utc } from '../db/types.js';
import { UserTable } from './user.sql.js';

export const UserFingerprintTable = pgTable(
	'user_fingerprint',
	{
		...id,
		...timestamps,
		userId: ulid('user_id')
			.notNull()
			.references(() => UserTable.id, { onDelete: 'cascade' }),
		fingerprint: text('fingerprint').notNull(),
		name: text('name'),
		lastSeen: utc('last_seen')
	},
	(t) => [
		uniqueIndex('user_fingerprint_fingerprint_unique').on(t.fingerprint),
		index('user_fingerprint_user_idx').on(t.userId)
	]
);
