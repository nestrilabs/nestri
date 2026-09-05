import { afterAll, beforeEach, describe, expect, test } from 'bun:test';

import { testDb } from '../db/test.js';
import { PostgresStorage } from './storage.js';

const sql = testDb();
const storage = PostgresStorage();

const PREFIX = 'kv-fixture';

async function cleanup() {
	await sql`delete from auth_kv where key like ${PREFIX + '%'}`;
}

beforeEach(cleanup);
afterAll(async () => {
	await cleanup();
	await sql.end();
});

describe('PostgresStorage', () => {
	test('a missing key reads as undefined', async () => {
		expect(await storage.get([PREFIX, 'absent'])).toBeUndefined();
	});

	test('what was set is what is read back', async () => {
		await storage.set([PREFIX, 'counter'], { count: 3, resetAt: 12345 });
		expect(await storage.get([PREFIX, 'counter'])).toEqual({ count: 3, resetAt: 12345 });
	});

	test('setting the same key again replaces the value', async () => {
		await storage.set([PREFIX, 'counter'], { count: 1 });
		await storage.set([PREFIX, 'counter'], { count: 2 });

		expect(await storage.get([PREFIX, 'counter'])).toEqual({ count: 2 });
		const [row] = await sql`select count(*)::int as n from auth_kv where key like ${PREFIX + '%'}`;
		expect(row!.n).toBe(1);
	});

	test('removing a key makes it unreadable', async () => {
		await storage.set([PREFIX, 'gone'], { a: 1 });
		await storage.remove([PREFIX, 'gone']);
		expect(await storage.get([PREFIX, 'gone'])).toBeUndefined();
	});

	test('an expired value reads as absent', async () => {
		await storage.set([PREFIX, 'stale'], { a: 1 }, new Date(Date.now() - 1000));
		expect(await storage.get([PREFIX, 'stale'])).toBeUndefined();
	});

	test('a value with an expiry in the future is still readable', async () => {
		await storage.set([PREFIX, 'live'], { a: 1 }, new Date(Date.now() + 60_000));
		expect(await storage.get([PREFIX, 'live'])).toEqual({ a: 1 });
	});

	test('scan returns everything under a prefix, split back into a key array', async () => {
		await storage.set([PREFIX, 'scan', 'one'], { n: 1 });
		await storage.set([PREFIX, 'scan', 'two'], { n: 2 });

		const found = await Array.fromAsync(storage.scan([PREFIX, 'scan']));
		expect(found).toHaveLength(2);
		expect(found.map(([key]) => key)).toEqual([
			[PREFIX, 'scan', 'one'],
			[PREFIX, 'scan', 'two']
		]);
		expect(found.map(([, value]) => value)).toEqual([{ n: 1 }, { n: 2 }]);
	});

	/**
	 * A prefix match on the bare string would return these too, and the keys
	 * that hit this are real ones — a subject is a prefix of a longer subject.
	 */
	test('scan does not reach into a prefix that merely starts the same way', async () => {
		await storage.set([PREFIX, 'user'], { n: 1 });
		await storage.set([PREFIX, 'user-extended'], { n: 2 });
		await storage.set([PREFIX, 'user', 'child'], { n: 3 });

		const found = await Array.fromAsync(storage.scan([PREFIX, 'user']));
		expect(found.map(([, value]) => value)).toEqual([{ n: 3 }]);
	});

	/** `%` and `_` are LIKE wildcards, and keys here are built from user input. */
	test('a key containing LIKE wildcards does not widen a scan', async () => {
		await storage.set([PREFIX, '%'], { n: 1 });
		await storage.set([PREFIX, 'literal'], { n: 2 });
		await storage.set([PREFIX, '%', 'child'], { n: 3 });

		const found = await Array.fromAsync(storage.scan([PREFIX, '%']));
		expect(found.map(([, value]) => value)).toEqual([{ n: 3 }]);
	});

	test('scan skips values that have expired', async () => {
		await storage.set([PREFIX, 'mixed', 'live'], { n: 1 }, new Date(Date.now() + 60_000));
		await storage.set([PREFIX, 'mixed', 'dead'], { n: 2 }, new Date(Date.now() - 1000));

		const found = await Array.fromAsync(storage.scan([PREFIX, 'mixed']));
		expect(found.map(([, value]) => value)).toEqual([{ n: 1 }]);
	});
});
