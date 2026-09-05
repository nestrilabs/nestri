import { jsonb, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';

import { id, timestamps, utc } from '../db/types.js';

/**
 * An authorization code, between the redirect that issued it and the exchange
 * that spends it.
 *
 * It lives sixty seconds, which is the same argument the device grant makes:
 * short-lived state in a table anyway, because redeeming it has to happen
 * exactly once and a store that reads and writes whole records cannot promise
 * that. Here the exchange is one `delete ... returning`, so of two requests
 * carrying the same code exactly one is answered — and the other is answered
 * as though the code never existed, which from the outside it now does not.
 *
 * `code_hash` and not the code. A code travels to the browser in a query
 * string, so it passes through history, referrer headers and any log along the
 * redirect. What is kept is enough to recognise one and not enough to present
 * it.
 */
export const AuthorizationCodeTable = pgTable(
	'authorization_code',
	{
		...id,
		...timestamps,

		codeHash: text('code_hash').notNull(),
		expiresAt: utc('expires_at').notNull(),

		/**
		 * Who the code stands for and what it may be exchanged under: the
		 * subject, the client, the redirect it was issued against, the token
		 * lifetimes, and the PKCE challenge if there was one.
		 */
		payload: jsonb('payload').$type<Record<string, unknown>>().notNull()
	},
	(t) => [uniqueIndex('authorization_code_hash_unique').on(t.codeHash)]
);
