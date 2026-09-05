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
 * `create` drops its write when the kind already has a live key, which is what
 * the interface asks for and what keeps two workers bootstrapping at the same
 * moment from ending up with a key each. Which of them wins does not matter.
 * That they end up agreeing does — a key each means cookies one worker writes
 * are unreadable to the other, and tokens one mints are rejected by the other.
 *
 * The conflict clause names no target on purpose: both unique indexes on this
 * table mean the same thing here, that the row we wanted already exists in some
 * form, and the answer to either is to keep what is there and read it back.
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
					.onConflictDoNothing();
			});
		}
	};
}
