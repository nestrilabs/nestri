import { index, jsonb, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';

import { id, timestamps, utc } from '../db/types.js';

/**
 * A refresh token: the longest-lived credential the issuer hands out.
 *
 * Two things make this a table rather than a cache entry, and neither is
 * durability.
 *
 * The first is `time_used`. Reuse detection works by remembering when a token
 * was first spent, so the check that it has not been spent and the record that
 * it now has must be the same operation. Read it, compare, write it back, and
 * two refreshes arriving together both look like the first one — which is
 * exactly the case reuse detection exists to catch. Here it is one
 * `update ... where time_used is null returning *`, so of two callers only one
 * is ever told it went first.
 *
 * The second is that these rows are a person's sessions. Signing out
 * everywhere, and the mass revocation that follows a detected reuse, are a
 * query over `subject` — which is a thing to be indexed rather than a prefix
 * scan over every key in a store.
 *
 * `token_hash` and not the token. Whoever holds a refresh token can resume the
 * session it belongs to, so a readable store would otherwise be a readable set
 * of every live session.
 */
export const RefreshTokenTable = pgTable(
	'refresh_token',
	{
		...id,
		...timestamps,

		/** The issuer's subject string, e.g. `user:0123456789abcdef`. */
		subject: text('subject').notNull(),
		tokenHash: text('token_hash').notNull(),
		expiresAt: utc('expires_at').notNull(),

		/** Null until the token is spent. Written exactly once, by whoever spends it. */
		timeUsed: utc('time_used'),

		/** The subject type, properties, client and token lifetimes this stands for. */
		payload: jsonb('payload').$type<Record<string, unknown>>().notNull()
	},
	(t) => [
		uniqueIndex('refresh_token_hash_unique').on(t.tokenHash),
		index('refresh_token_subject_idx').on(t.subject)
	]
);
