import { afterAll, beforeEach, describe, expect, test } from 'bun:test';

import type { AuthorizationCodeRecord } from '@nestri/auth/authorization-code';

import { testDb } from '../db/test.js';
import { PostgresCodeStore } from './authorization-code.js';

const sql = testDb();
const store = PostgresCodeStore();

let counter = 0;
function hash(): string {
	counter += 1;
	return `authcode-fixture-${counter}`.padEnd(64, '0');
}

function record(): AuthorizationCodeRecord {
	return {
		type: 'user',
		properties: { userID: 'usr_fixture' },
		subject: 'user:authcode-fixture',
		clientID: 'desktop',
		redirectURI: 'https://example.com/callback',
		ttl: { access: 60, refresh: 600 }
	};
}

async function cleanup() {
	await sql`delete from authorization_code where code_hash like 'authcode-fixture-%'`;
}

beforeEach(cleanup);
afterAll(async () => {
	await cleanup();
	await sql.end();
});

describe('PostgresCodeStore', () => {
	test('an unknown code returns null', async () => {
		expect(await store.consume(hash())).toBeNull();
	});

	test('consuming returns the record it was created with', async () => {
		const h = hash();
		await store.create(h, record(), 60);

		const consumed = await store.consume(h);
		expect(consumed?.redirectURI).toBe('https://example.com/callback');
		expect(consumed?.clientID).toBe('desktop');
	});

	test('a code is redeemable once', async () => {
		const h = hash();
		await store.create(h, record(), 60);

		expect(await store.consume(h)).not.toBeNull();
		expect(await store.consume(h)).toBeNull();
	});

	/**
	 * The property the table exists for: two exchanges of one code arriving
	 * together must not both be answered, because each answer is a full
	 * session. Started without awaiting in turn so they really do overlap.
	 */
	test('only one of several simultaneous exchanges is served', async () => {
		const h = hash();
		await store.create(h, record(), 60);

		const results = await Promise.all(Array.from({ length: 5 }, () => store.consume(h)));

		expect(results.filter((r) => r !== null)).toHaveLength(1);
	});

	test('an expired code cannot be redeemed', async () => {
		const h = hash();
		await store.create(h, record(), 60);
		await sql`update authorization_code set expires_at = now() - interval '1 second' where code_hash = ${h}`;

		expect(await store.consume(h)).toBeNull();
	});

	test('creating sweeps codes that have already expired', async () => {
		const stale = hash();
		await store.create(stale, record(), 60);
		await sql`update authorization_code set expires_at = now() - interval '1 second' where code_hash = ${stale}`;

		await store.create(hash(), record(), 60);

		const [row] = await sql`select count(*)::int as n from authorization_code where code_hash = ${stale}`;
		expect(row!.n).toBe(0);
	});
});
