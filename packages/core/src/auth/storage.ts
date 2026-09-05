import type { StorageAdapter } from '@nestri/auth/storage/storage';
import { joinKey, splitKey } from '@nestri/auth/storage/storage';
import { and, eq, isNull, lt, or, sql } from 'drizzle-orm';

import { Database } from '../db/index.js';
import { Identifier } from '../id.js';
import { AuthKvTable } from './storage.sql.js';

/** Whether a row is still live, as a SQL fragment. */
const unexpired = () => or(isNull(AuthKvTable.expiresAt), sql`${AuthKvTable.expiresAt} > now()`);

/**
 * A prefix, escaped so that a key containing `%` or `_` cannot widen the match.
 *
 * Postgres treats both as wildcards in `LIKE`, and the keys here are built
 * from caller-supplied strings — an email address, a caller's own address —
 * so neither character is hypothetical.
 */
function escapeLike(value: string): string {
	return value.replace(/([\\%_])/g, '\\$1');
}

/**
 * The issuer's remaining key-value state, in Postgres.
 *
 * This is the small half of what used to be one store: the counters behind the
 * device-code guess limit and the sign-in code retry limit. Everything with a
 * shape moved to a table that names its fields — see `AuthKvTable`.
 *
 * There is no sweeper. Expired rows are removed when they are next read and
 * when a write happens to notice them, which is enough because every key here
 * is written far more often than the table grows: a counter is rewritten on
 * every attempt by the same caller, and there are only ever as many rows as
 * there are callers inside one window.
 */
export function PostgresStorage(): StorageAdapter {
	return {
		async get(key: string[]) {
			const joined = joinKey(key);
			return Database.use(async (tx) =>
				tx
					.select({ value: AuthKvTable.value })
					.from(AuthKvTable)
					.where(and(eq(AuthKvTable.key, joined), unexpired()))
					.then((rows) => rows[0]?.value)
			);
		},

		async set(key: string[], value: any, expiry?: Date) {
			const joined = joinKey(key);
			await Database.use(async (tx) => {
				// Swept opportunistically rather than on a schedule, on the
				// only statement here that can add a row.
				await tx.delete(AuthKvTable).where(lt(AuthKvTable.expiresAt, new Date()));

				await tx
					.insert(AuthKvTable)
					.values({
						id: Identifier.ascending('authKv'),
						key: joined,
						value,
						expiresAt: expiry ?? null
					})
					.onConflictDoUpdate({
						target: AuthKvTable.key,
						set: { value, expiresAt: expiry ?? null, timeUpdated: new Date() }
					});
			});
		},

		async remove(key: string[]) {
			const joined = joinKey(key);
			await Database.use(async (tx) => {
				await tx.delete(AuthKvTable).where(eq(AuthKvTable.key, joined));
			});
		},

		async *scan(prefix: string[]) {
			// The separator is part of the prefix, so that scanning `['a']`
			// cannot also return the keys under `['ab']`. Matching on the bare
			// prefix is a real collision — subjects and email addresses are
			// both prefixes of longer subjects and email addresses.
			const pattern = escapeLike(joinKey([...prefix, ''])) + '%';
			const rows = await Database.use(async (tx) =>
				tx
					.select({ key: AuthKvTable.key, value: AuthKvTable.value })
					.from(AuthKvTable)
					.where(and(sql`${AuthKvTable.key} LIKE ${pattern}`, unexpired()))
					.orderBy(AuthKvTable.key)
			);
			for (const row of rows) {
				yield [splitKey(row.key), row.value] as [string[], any];
			}
		}
	};
}
