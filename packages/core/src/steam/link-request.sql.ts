import { index, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';

import { id, timestamps, ulid, utc } from '../db/types.js';
import { UserTable } from '../user/user.sql.js';

/**
 * A person partway through proving a Steam account is theirs.
 *
 * Linking goes through Steam's own sign-in, which leaves this site and comes
 * back to a callback that carries no session — so the request is how the
 * callback knows who it is for. One use, minutes long, and stored only as a
 * digest, because the nonce travels in a URL.
 */
export const SteamLinkRequestTable = pgTable(
	'steam_link_request',
	{
		...id,
		...timestamps,
		userId: ulid('user_id')
			.notNull()
			.references(() => UserTable.id, { onDelete: 'cascade' }),
		nonceHash: text('nonce_hash').notNull(),
		expiresAt: utc('expires_at').notNull(),
		usedAt: utc('used_at')
	},
	(t) => [
		uniqueIndex('steam_link_request_nonce_unique').on(t.nonceHash),
		index('steam_link_request_user_idx').on(t.userId)
	]
);
