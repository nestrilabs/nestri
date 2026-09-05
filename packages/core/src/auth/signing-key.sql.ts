import { sql } from 'drizzle-orm';
import { pgEnum, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';

import { id, timestamps, utc } from '../db/types.js';

export const AuthKeyKindEnum = pgEnum('auth_key_kind', ['signing', 'encryption']);

/**
 * The issuer's own key material.
 *
 * The longest-lived thing here by a wide margin, and the only record whose
 * loss is felt by everyone at once: every access token names the key that
 * signed it, so a fresh key set means every session ends and every client has
 * to sign in again. That is the argument for a table rather than a cache —
 * not query patterns, just that this is the row nobody can afford to have
 * quietly evicted.
 *
 * Retiring a key sets `expired_at` instead of deleting it, so a verifier
 * reading the published JWKS can still check a token signed before a rotation.
 *
 * At most one key of a kind may be live at a time, and the partial unique index
 * is what enforces it rather than a convention. Without it, two workers
 * starting against an empty table both find no key, both insert one, and each
 * then signs and encrypts with its own — so a session cookie written by one is
 * undecryptable to the other, and an access token minted by one is rejected by
 * the other. Both reach for a single key rather than trying the whole set, so
 * the split is silent until someone cannot sign in. With the index the second
 * insert is dropped, both read the table again, and both use the key that won.
 */
export const AuthKeyTable = pgTable(
	'auth_key',
	{
		...id,
		...timestamps,

		/** The issuer's own identifier for the key, and the `kid` on the JWT. */
		keyId: text('key_id').notNull(),
		kind: AuthKeyKindEnum('kind').notNull(),

		/** JWA name, on the row rather than assumed, so a rotation may change it. */
		alg: text('alg').notNull(),
		publicKey: text('public_key').notNull(),
		privateKey: text('private_key').notNull(),

		/** Null while the key is still in use. Set when it is retired. */
		expiredAt: utc('expired_at')
	},
	(t) => [
		uniqueIndex('auth_key_key_id_unique').on(t.keyId),
		uniqueIndex('auth_key_one_live_per_kind')
			.on(t.kind)
			.where(sql`${t.expiredAt} is null`)
	]
);
