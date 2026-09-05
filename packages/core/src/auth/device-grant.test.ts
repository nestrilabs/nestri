import { afterAll, beforeEach, describe, expect, test } from 'bun:test';

import type { DeviceGrant, DeviceGrantSubject } from '@nestri/auth/device';

import { testDb } from '../db/test.js';
import { PostgresDeviceStore } from './device-grant.js';

const sql = testDb();
const store = PostgresDeviceStore();

const SUBJECT: DeviceGrantSubject = {
	subject: 'user:usr_fixture',
	type: 'user',
	properties: { userID: 'usr_fixture' },
	ttl: { access: 60, refresh: 600 }
};

let counter = 0;
function hash(): string {
	counter += 1;
	return `device-grant-fixture-${counter}`.padEnd(64, '0');
}

function pending(overrides: Partial<DeviceGrant> = {}): DeviceGrant {
	const deviceCodeHash = overrides.deviceCodeHash ?? hash();
	return {
		deviceCodeHash,
		userCode: `UC${deviceCodeHash.slice(-6)}`,
		clientID: 'desktop',
		status: 'pending',
		interval: 5,
		lastPolled: 0,
		expires: Date.now() + 600_000,
		...overrides
	};
}

async function cleanup() {
	await sql`delete from device_grant where device_code_hash like 'device-grant-fixture-%'`;
}

beforeEach(cleanup);
afterAll(async () => {
	await cleanup();
	await sql.end();
});

describe('what the store remembers', () => {
	test('a grant is findable by either code, and comes back as it went in', async () => {
		const grant = pending();
		await store.create(grant);

		const byDevice = await store.byDeviceCode(grant.deviceCodeHash);
		expect(byDevice).toMatchObject({
			deviceCodeHash: grant.deviceCodeHash,
			userCode: grant.userCode,
			clientID: 'desktop',
			status: 'pending',
			interval: 5,
			lastPolled: 0
		});
		expect((await store.byUserCode(grant.userCode))?.deviceCodeHash).toBe(grant.deviceCodeHash);
	});

	test('creating a grant clears out the ones that aged out', async () => {
		const stale = pending({ expires: Date.now() - 1000 });
		await store.create(stale);
		await store.create(pending());

		const rows = await sql`
			select count(*)::int as n from device_grant where device_code_hash = ${stale.deviceCodeHash}
		`;
		expect(rows[0]!.n).toBe(0);
	});
});

/**
 * The properties the flow is built on, asserted against a real database.
 *
 * Each of these is a claim that a transition happens once even though two
 * parties are racing for it, and each is enforced by a `where` clause rather
 * than by application code. That is exactly the sort of claim that reads as
 * obviously true and is obviously false the moment the condition is dropped, so
 * it is worth a test that would notice.
 */
describe('transitions that must happen once', () => {
	test('a grant is approved once', async () => {
		const grant = pending();
		await store.create(grant);

		expect(await store.approve(grant.deviceCodeHash, SUBJECT)).toBe(true);
		expect(await store.approve(grant.deviceCodeHash, SUBJECT)).toBe(false);
	});

	test('an approval cannot overwrite a refusal', async () => {
		const grant = pending();
		await store.create(grant);

		expect(await store.deny(grant.deviceCodeHash)).toBe(true);
		expect(await store.approve(grant.deviceCodeHash, SUBJECT)).toBe(false);
		expect((await store.byDeviceCode(grant.deviceCodeHash))?.status).toBe('denied');
	});

	test('a refusal cannot overwrite an approval', async () => {
		const grant = pending();
		await store.create(grant);

		expect(await store.approve(grant.deviceCodeHash, SUBJECT)).toBe(true);
		expect(await store.deny(grant.deviceCodeHash)).toBe(false);
		expect((await store.byDeviceCode(grant.deviceCodeHash))?.status).toBe('approved');
	});

	test('several approvals arriving together settle on one', async () => {
		const grant = pending();
		await store.create(grant);

		const results = await Promise.all(
			Array.from({ length: 5 }, () => store.approve(grant.deviceCodeHash, SUBJECT))
		);
		expect(results.filter(Boolean)).toHaveLength(1);
	});

	test('a grant that has aged out can no longer be answered', async () => {
		const grant = pending({ expires: Date.now() - 1000 });
		// Inserted directly, because creating one sweeps it.
		await sql`
			insert into device_grant (id, device_code_hash, user_code, client_id, status, poll_interval, expires_at)
			values ('dvg_expired_fixture0000000000', ${grant.deviceCodeHash}, ${grant.userCode},
				'desktop', 'pending', 5, now() - interval '1 second')
		`;

		expect(await store.approve(grant.deviceCodeHash, SUBJECT)).toBe(false);
		expect(await store.deny(grant.deviceCodeHash)).toBe(false);
	});
});

describe('redeeming', () => {
	test('an approved grant is redeemed once, and carries who it was for', async () => {
		const grant = pending();
		await store.create(grant);
		await store.approve(grant.deviceCodeHash, SUBJECT);

		const claimed = await store.consume(grant.deviceCodeHash, 'desktop');
		expect(claimed?.subject).toEqual(SUBJECT);
		expect(await store.consume(grant.deviceCodeHash, 'desktop')).toBeNull();
	});

	test('several polls arriving together are served once', async () => {
		const grant = pending();
		await store.create(grant);
		await store.approve(grant.deviceCodeHash, SUBJECT);

		const results = await Promise.all(
			Array.from({ length: 5 }, () => store.consume(grant.deviceCodeHash, 'desktop'))
		);
		expect(results.filter(Boolean)).toHaveLength(1);
	});

	test('another client cannot redeem the code', async () => {
		const grant = pending();
		await store.create(grant);
		await store.approve(grant.deviceCodeHash, SUBJECT);

		expect(await store.consume(grant.deviceCodeHash, 'somebody-else')).toBeNull();
		// And the real client is not robbed of it in the attempt.
		expect(await store.consume(grant.deviceCodeHash, 'desktop')).not.toBeNull();
	});

	test('a grant nobody approved is not redeemable', async () => {
		const grant = pending();
		await store.create(grant);
		expect(await store.consume(grant.deviceCodeHash, 'desktop')).toBeNull();
	});
});

/**
 * The bug this store exists to make impossible.
 *
 * A poll reads a pending grant, the browser approves while the poll is in
 * flight, and then the poll writes down that it happened. If writing that down
 * means writing the whole record back, the approval is gone and the client
 * polls a dead grant until it expires.
 */
describe('recording a poll', () => {
	test('touches the bookkeeping and nothing else', async () => {
		const grant = pending();
		await store.create(grant);

		const stale = await store.byDeviceCode(grant.deviceCodeHash);
		expect(stale!.status).toBe('pending');

		await store.approve(grant.deviceCodeHash, SUBJECT);
		await store.recordPoll(grant.deviceCodeHash, Date.now(), stale!.interval + 5);

		const after = await store.byDeviceCode(grant.deviceCodeHash);
		expect(after!.status).toBe('approved');
		expect(after!.subject).toEqual(SUBJECT);
		expect(after!.interval).toBe(10);
		expect(after!.lastPolled).toBeGreaterThan(0);
	});
});
