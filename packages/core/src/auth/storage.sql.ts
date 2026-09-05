import { jsonb, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';

import { id, timestamps, utc } from '../db/types.js';

/**
 * What is left of the issuer's key-value store once everything with a shape
 * has been given a table of its own.
 *
 * Signing keys, authorization codes and refresh tokens each moved out, because
 * each is a record whose fields are worth naming, whose changes are worth a
 * migration, and — for the last two — whose transitions have to happen exactly
 * once. What remains is counters: how many user codes an address has guessed
 * at, how many times a sign-in code has been retried, when a code was last
 * sent. They have none of those properties. A counter is written far more often
 * than it is read, is meaningless an hour later, and is allowed to be
 * approximate — losing one increment costs an attacker one extra guess out of a
 * budget of ten.
 *
 * So this table stays deliberately generic, and is the one place a `jsonb`
 * blob with no migration behind it is the right answer rather than a shortcut.
 */
export const AuthKvTable = pgTable(
	'auth_kv',
	{
		...id,
		...timestamps,

		/**
		 * The caller's key array, joined by the unit separator the issuer's
		 * storage interface uses. Stored as one string rather than split into
		 * columns because nothing here ever queries a component of it.
		 */
		key: text('key').notNull(),
		value: jsonb('value').$type<Record<string, unknown>>().notNull(),
		/** Null for a record with no expiry. */
		expiresAt: utc('expires_at')
	},
	(t) => [uniqueIndex('auth_kv_key_unique').on(t.key)]
);
