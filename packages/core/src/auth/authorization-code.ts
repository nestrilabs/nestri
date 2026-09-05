import type { AuthorizationCodeRecord, CodeStore } from '@nestri/auth/authorization-code';
import { and, eq, lt, sql } from 'drizzle-orm';

import { Database } from '../db/index.js';
import { Identifier } from '../id.js';
import { AuthorizationCodeTable } from './authorization-code.sql.js';

/**
 * Authorization codes, kept where redeeming one can be a single statement.
 *
 * `consume` is a delete that returns what it deleted, which is the whole point
 * of the table: it is what makes a code redeemable once rather than
 * approximately once. A select, a decision in application code and a delete
 * would answer two simultaneous exchanges of the same code, and each answer is
 * a complete session.
 */
export function PostgresCodeStore(): CodeStore {
	return {
		async create(codeHash, record, ttl) {
			await Database.use(async (tx) => {
				// Swept here rather than on a schedule. A code lives a minute
				// and this is the only statement that adds one, so the table
				// stays bounded by how many sign-ins are mid-redirect.
				await tx
					.delete(AuthorizationCodeTable)
					.where(lt(AuthorizationCodeTable.expiresAt, new Date()));

				await tx.insert(AuthorizationCodeTable).values({
					id: Identifier.ascending('authorizationCode'),
					codeHash,
					expiresAt: new Date(Date.now() + ttl * 1000),
					payload: record as unknown as Record<string, unknown>
				});
			});
		},

		async consume(codeHash) {
			return Database.use(async (tx) =>
				tx
					.delete(AuthorizationCodeTable)
					.where(
						and(
							eq(AuthorizationCodeTable.codeHash, codeHash),
							sql`${AuthorizationCodeTable.expiresAt} > now()`
						)
					)
					.returning({ payload: AuthorizationCodeTable.payload })
					.then((rows) =>
						rows[0] ? (rows[0].payload as unknown as AuthorizationCodeRecord) : null
					)
			);
		}
	};
}
