import type { KeyKind, KeyStore, StoredKey } from '@nestri/auth/key';
import { eq } from 'drizzle-orm';

import { Database } from '../db/index.js';
import { Identifier } from '../id.js';
import { AuthKeyTable } from './signing-key.sql.js';

type Row = typeof AuthKeyTable.$inferSelect;

function toStored(row: Row): StoredKey {
	return {
		id: row.keyId,
		publicKey: row.publicKey,
		privateKey: row.privateKey,
		alg: row.alg,
		created: row.timeCreated.getTime(),
		expired: row.expiredAt?.getTime()
	};
}

/**
 * The issuer's signing and encryption keys, in Postgres.
 *
 * Two issuers starting against an empty table both generate a key and both
 * insert one, and that is fine: each is valid, both are published in the JWKS,
 * so a token signed by either verifies against either issuer. The conflict
 * clause is not for that race — a key id is a fresh UUID and cannot collide
 * with another issuer's — it is so that a retried write is not an error.
 */
export function PostgresKeyStore(): KeyStore {
	return {
		async list(kind: KeyKind) {
			return Database.use(async (tx) =>
				tx
					.select()
					.from(AuthKeyTable)
					.where(eq(AuthKeyTable.kind, kind))
					.then((rows) => rows.map(toStored))
			);
		},

		async create(kind: KeyKind, key: StoredKey) {
			await Database.use(async (tx) => {
				await tx
					.insert(AuthKeyTable)
					.values({
						id: Identifier.ascending('authKey'),
						keyId: key.id,
						kind,
						alg: key.alg,
						publicKey: key.publicKey,
						privateKey: key.privateKey,
						expiredAt: key.expired ? new Date(key.expired) : null
					})
					.onConflictDoNothing({ target: AuthKeyTable.keyId });
			});
		}
	};
}
