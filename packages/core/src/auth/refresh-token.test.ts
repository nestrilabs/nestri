import { afterAll, beforeEach, describe, expect, test } from 'bun:test';

import type { RefreshRecord } from '@nestri/auth/refresh';

import { testDb } from '../db/test.js';
import { PostgresRefreshStore } from './refresh-token.js';

const sql = testDb();
const store = PostgresRefreshStore();

const SUBJECT = 'user:refresh-fixture';

let counter = 0;
function hash(): string {
	counter += 1;
	return `refresh-fixture-${counter}`.padEnd(64, '0');
}

function record(overrides: Partial<RefreshRecord> = {}): RefreshRecord {
	return {
		type: 'user',
		properties: { userID: 'usr_fixture' },
		subject: SUBJECT,
		clientID: 'desktop',
		ttl: { access: 60, refresh: 600 },
		nextToken: 'next',
		...overrides
	};
}

async function cleanup() {
	await sql`delete from refresh_token where token_hash like 'refresh-fixture-%'`;
}

beforeEach(cleanup);
afterAll(async () => {
	await cleanup();
	await sql.end();
});

describe('PostgresRefreshStore', () => {
	test('an unknown token is missing rather than an error', async () => {
		const claim = await store.claim(SUBJECT, hash(), Date.now(), 60);
		expect(claim.status).toBe('missing');
	});

	test('a token belonging to another subject is not spendable', async () => {
		const h = hash();
		await store.create(SUBJECT, h, record(), 600);

		const claim = await store.claim('user:someone-else', h, Date.now(), 60);
		expect(claim.status).toBe('missing');
	});

	test('the first claim is fresh and carries the record back', async () => {
		const h = hash();
		await store.create(SUBJECT, h, record(), 600);

		const claim = await store.claim(SUBJECT, h, Date.now(), 60);
		expect(claim.status).toBe('fresh');
		if (claim.status !== 'fresh') throw new Error('unreachable');
		expect(claim.record.clientID).toBe('desktop');
		expect(claim.record.nextToken).toBe('next');
	});

	test('a second claim reports the reuse and when the token was first spent', async () => {
		const h = hash();
		const at = Date.now();
		await store.create(SUBJECT, h, record(), 600);

		await store.claim(SUBJECT, h, at, 60);
		const again = await store.claim(SUBJECT, h, at + 1000, 60);

		expect(again.status).toBe('reused');
		if (again.status !== 'reused') throw new Error('unreachable');
		// The time the *first* caller spent it, not the time of this attempt —
		// which is what the reuse window is measured from.
		expect(again.timeUsed).toBe(at);
	});

	/**
	 * The property the whole table exists for.
	 *
	 * Five claims of one token, started together and never awaited in turn, so
	 * they genuinely overlap in the database rather than queueing behind each
	 * other. Exactly one may be told it went first; through a store that reads
	 * and writes whole records, all five are.
	 */
	test('only one of several simultaneous claims is fresh', async () => {
		const h = hash();
		const at = Date.now();
		await store.create(SUBJECT, h, record(), 600);

		const claims = await Promise.all(
			Array.from({ length: 5 }, () => store.claim(SUBJECT, h, at, 60))
		);

		expect(claims.filter((c) => c.status === 'fresh')).toHaveLength(1);
		expect(claims.filter((c) => c.status === 'reused')).toHaveLength(4);
	});

	test('with no retention the token is taken away, and later claims find nothing', async () => {
		const h = hash();
		await store.create(SUBJECT, h, record(), 600);

		const first = await store.claim(SUBJECT, h, Date.now(), 0);
		const second = await store.claim(SUBJECT, h, Date.now(), 0);

		expect(first.status).toBe('fresh');
		// Not `reused`: nothing was retained, so there is nothing left to
		// recognise. Reuse detection is what retention buys.
		expect(second.status).toBe('missing');
	});

	test('an expired token cannot be spent', async () => {
		const h = hash();
		await store.create(SUBJECT, h, record(), 600);
		await sql`update refresh_token set expires_at = now() - interval '1 second' where token_hash = ${h}`;

		const claim = await store.claim(SUBJECT, h, Date.now(), 60);
		expect(claim.status).toBe('missing');
	});

	test('removing a subject takes every token it has and leaves other subjects alone', async () => {
		const mine = [hash(), hash()];
		const theirs = hash();
		for (const h of mine) await store.create(SUBJECT, h, record(), 600);
		await store.create('user:other', theirs, record({ subject: 'user:other' }), 600);

		await store.removeSubject(SUBJECT);

		for (const h of mine) {
			expect((await store.claim(SUBJECT, h, Date.now(), 60)).status).toBe('missing');
		}
		expect((await store.claim('user:other', theirs, Date.now(), 60)).status).toBe('fresh');
	});
});
