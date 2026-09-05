import type { RefreshClaim, RefreshRecord, RefreshStore } from '@nestri/auth/refresh';
import { and, eq, isNull, lt, sql } from 'drizzle-orm';

import { Database } from '../db/index.js';
import { Identifier } from '../id.js';
import { RefreshTokenTable } from './refresh-token.sql.js';

/**
 * Refresh tokens, kept where spending one is a single statement.
 *
 * `claim` is the reason this exists. Everything else here is ordinary.
 */
export function PostgresRefreshStore(): RefreshStore {
	return {
		async create(subject, tokenHash, record, ttl) {
			await Database.use(async (tx) => {
				// Swept on the statement that adds rows, as everywhere else in
				// this module. A refresh token lives a year by default, so this
				// sweep is about the tokens that were spent and retained for
				// reuse detection rather than about the live ones.
				await tx.delete(RefreshTokenTable).where(lt(RefreshTokenTable.expiresAt, new Date()));

				await tx.insert(RefreshTokenTable).values({
					id: Identifier.ascending('refreshToken'),
					subject,
					tokenHash,
					expiresAt: new Date(Date.now() + ttl * 1000),
					timeUsed: record.timeUsed ? new Date(record.timeUsed) : null,
					payload: record as unknown as Record<string, unknown>
				});
			});
		},

		async claim(subject, tokenHash, at, retainFor) {
			const live = and(
				eq(RefreshTokenTable.tokenHash, tokenHash),
				eq(RefreshTokenTable.subject, subject),
				sql`${RefreshTokenTable.expiresAt} > now()`
			);

			return Database.use(async (tx): Promise<RefreshClaim> => {
				// Nothing is retained, so spending the token is taking it away.
				// One caller gets the row; every other attempt reads `missing`,
				// which is the correct answer once it no longer exists.
				if (retainFor <= 0) {
					const [row] = await tx.delete(RefreshTokenTable).where(live).returning();
					if (!row) return { status: 'missing' };
					return { status: 'fresh', record: row.payload as unknown as RefreshRecord };
				}

				// `where time_used is null` is what makes going first happen
				// once. Two refreshes arriving together both run this; the
				// second matches no row, because by then `time_used` is set.
				// The expiry is pushed out to the retention window so the spent
				// record survives long enough to recognise a reuse.
				const [claimed] = await tx
					.update(RefreshTokenTable)
					.set({ timeUsed: new Date(at), expiresAt: new Date(at + retainFor * 1000) })
					.where(and(live, isNull(RefreshTokenTable.timeUsed)))
					.returning();
				if (claimed) {
					return { status: 'fresh', record: claimed.payload as unknown as RefreshRecord };
				}

				// Either it was spent already or it was never here. Reading now
				// is safe where reading first was not: `time_used` is written
				// once and never changes, so there is no decision left to race.
				const [existing] = await tx.select().from(RefreshTokenTable).where(live);
				if (!existing?.timeUsed) return { status: 'missing' };
				return {
					status: 'reused',
					record: existing.payload as unknown as RefreshRecord,
					timeUsed: existing.timeUsed.getTime()
				};
			});
		},

		async removeSubject(subject) {
			await Database.use(async (tx) => {
				await tx.delete(RefreshTokenTable).where(eq(RefreshTokenTable.subject, subject));
			});
		}
	};
}
