import { index, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';

import { id, timestamps, ulid, utc } from '../db/types.js';
import { TeamTable } from '../team/team.sql.js';
import { UserTable } from '../user/user.sql.js';

/**
 * A personal access token: a long-lived, revocable credential a user creates
 * for something that is not a browser — a nessh box registering itself, or a
 * script driving the API.
 *
 * Deliberately not a session JWT. A JWT is short-lived and cannot be revoked
 * without rotating signing keys for everyone, which makes it wrong for a
 * credential that sits in a config file on a machine for months.
 */
export const AccessTokenTable = pgTable(
	'access_token',
	{
		...id,
		...timestamps,
		ownerUserId: ulid('owner_user_id')
			.notNull()
			.references(() => UserTable.id, { onDelete: 'cascade' }),
		// Set to act within a team rather than as the user alone. The grant is
		// re-checked against live membership on every use, so losing the
		// membership disables the token without anyone remembering to revoke it.
		teamId: ulid('team_id').references(() => TeamTable.id, { onDelete: 'cascade' }),
		name: text('name').notNull(),
		// Only the digest. The token is shown once, at creation.
		tokenHash: text('token_hash').notNull(),
		expiresAt: utc('expires_at'),
		lastUsed: utc('last_used')
	},
	(t) => [
		uniqueIndex('access_token_hash_unique').on(t.tokenHash),
		index('access_token_owner_idx').on(t.ownerUserId),
		index('access_token_team_idx').on(t.teamId)
	]
);
