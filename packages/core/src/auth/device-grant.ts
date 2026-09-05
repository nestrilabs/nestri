import type { DeviceGrant, DeviceGrantSubject, DeviceStore } from '@nestri/auth/device';
import { and, eq, lt, sql } from 'drizzle-orm';

import { Database } from '../db/index.js';
import { Identifier } from '../id.js';
import { DeviceGrantTable } from './device-grant.sql.js';

type Row = typeof DeviceGrantTable.$inferSelect;

function toGrant(row: Row): DeviceGrant {
	return {
		deviceCodeHash: row.deviceCodeHash,
		userCode: row.userCode,
		clientID: row.clientId,
		status: row.status,
		interval: row.pollInterval,
		lastPolled: row.lastPolledAt?.getTime() ?? 0,
		expires: row.expiresAt.getTime(),
		subject: row.subject ?? undefined
	};
}

/**
 * Device authorization grants, kept where a conditional write is possible.
 *
 * Each method below is one statement on purpose. The interface asks for
 * transitions that happen exactly once while a browser and a polling client are
 * both touching the same grant, and the only way to promise that is to let the
 * database decide: `update ... where status = 'pending'` either changes a row
 * or does not, and `delete ... returning` hands the row to exactly one caller.
 * Read it, decide in application code, and write it back, and the two callers
 * undo each other — which is the bug this shape exists to make impossible.
 */
export function PostgresDeviceStore(): DeviceStore {
	return {
		async create(grant) {
			await Database.use(async (tx) => {
				// Swept here rather than on a schedule. A grant lives ten
				// minutes and this is the only statement that adds one, so the
				// table is bounded by how many sign-ins are in flight without
				// anything else having to run.
				await tx.delete(DeviceGrantTable).where(lt(DeviceGrantTable.expiresAt, new Date()));

				await tx.insert(DeviceGrantTable).values({
					id: Identifier.ascending('deviceGrant'),
					deviceCodeHash: grant.deviceCodeHash,
					userCode: grant.userCode,
					clientId: grant.clientID,
					status: grant.status,
					pollInterval: grant.interval,
					lastPolledAt: grant.lastPolled ? new Date(grant.lastPolled) : null,
					expiresAt: new Date(grant.expires),
					subject: grant.subject ?? null
				});
			});
		},

		async byDeviceCode(deviceCodeHash) {
			return Database.use(async (tx) =>
				tx
					.select()
					.from(DeviceGrantTable)
					.where(eq(DeviceGrantTable.deviceCodeHash, deviceCodeHash))
					.then((rows) => (rows[0] ? toGrant(rows[0]) : null))
			);
		},

		async byUserCode(userCode) {
			return Database.use(async (tx) =>
				tx
					.select()
					.from(DeviceGrantTable)
					.where(eq(DeviceGrantTable.userCode, userCode))
					.then((rows) => (rows[0] ? toGrant(rows[0]) : null))
			);
		},

		async approve(deviceCodeHash, subject: DeviceGrantSubject) {
			return Database.use(async (tx) =>
				tx
					.update(DeviceGrantTable)
					.set({ status: 'approved', subject })
					.where(
						and(
							eq(DeviceGrantTable.deviceCodeHash, deviceCodeHash),
							eq(DeviceGrantTable.status, 'pending'),
							sql`${DeviceGrantTable.expiresAt} > now()`
						)
					)
					.returning({ id: DeviceGrantTable.id })
					.then((rows) => rows.length > 0)
			);
		},

		async deny(deviceCodeHash) {
			return Database.use(async (tx) =>
				tx
					.update(DeviceGrantTable)
					.set({ status: 'denied' })
					.where(
						and(
							eq(DeviceGrantTable.deviceCodeHash, deviceCodeHash),
							eq(DeviceGrantTable.status, 'pending'),
							sql`${DeviceGrantTable.expiresAt} > now()`
						)
					)
					.returning({ id: DeviceGrantTable.id })
					.then((rows) => rows.length > 0)
			);
		},

		async consume(deviceCodeHash, clientID) {
			// Deleting and reading are the same statement, so two polls
			// arriving together cannot both be served: one deletes the row and
			// gets it, the other deletes nothing and gets nothing.
			return Database.use(async (tx) =>
				tx
					.delete(DeviceGrantTable)
					.where(
						and(
							eq(DeviceGrantTable.deviceCodeHash, deviceCodeHash),
							eq(DeviceGrantTable.clientId, clientID),
							eq(DeviceGrantTable.status, 'approved'),
							sql`${DeviceGrantTable.expiresAt} > now()`
						)
					)
					.returning()
					.then((rows) => (rows[0] ? toGrant(rows[0]) : null))
			);
		},

		async recordPoll(deviceCodeHash, at, interval) {
			// Two columns, and deliberately not the rest of the row. Writing
			// the whole grant back here is what would let a poll that read a
			// pending record undo an approval that landed while it was in
			// flight.
			await Database.use(async (tx) => {
				await tx
					.update(DeviceGrantTable)
					.set({ lastPolledAt: new Date(at), pollInterval: interval })
					.where(eq(DeviceGrantTable.deviceCodeHash, deviceCodeHash));
			});
		},

		async remove(deviceCodeHash) {
			await Database.use(async (tx) => {
				await tx
					.delete(DeviceGrantTable)
					.where(eq(DeviceGrantTable.deviceCodeHash, deviceCodeHash));
			});
		}
	};
}
