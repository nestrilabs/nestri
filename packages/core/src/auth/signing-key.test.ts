import { afterAll, beforeEach, describe, expect, test } from 'bun:test';

import type { StoredKey } from '@nestri/auth/key';

import { testDb } from '../db/test.js';
import { PostgresKeyStore } from './signing-key.js';

const sql = testDb();
const store = PostgresKeyStore();

let counter = 0;
function key(overrides: Partial<StoredKey> = {}): StoredKey {
	counter += 1;
	return {
		id: `key-fixture-${counter}`,
		publicKey: '-----BEGIN PUBLIC KEY-----fixture-----END PUBLIC KEY-----',
		privateKey: '-----BEGIN PRIVATE KEY-----fixture-----END PRIVATE KEY-----',
		alg: 'ES256',
		created: Date.now(),
		...overrides
	};
}

async function cleanup() {
	await sql`delete from auth_key where key_id like 'key-fixture-%'`;
}

beforeEach(cleanup);
afterAll(async () => {
	await cleanup();
	await sql.end();
});

describe('PostgresKeyStore', () => {
	test('a kind with no keys lists empty', async () => {
		expect(await store.list('encryption')).toEqual([]);
	});

	test('a stored key comes back with its fields intact', async () => {
		const k = key();
		await store.create('signing', k);

		const [found] = await store.list('signing');
		expect(found?.id).toBe(k.id);
		expect(found?.alg).toBe('ES256');
		expect(found?.privateKey).toBe(k.privateKey);
		// Absent rather than null: a key still in use has no expiry.
		expect(found?.expired).toBeUndefined();
	});

	test('the two kinds do not see each other', async () => {
		await store.create('signing', key());
		await store.create('encryption', key({ alg: 'RSA-OAEP-512' }));

		expect(await store.list('signing')).toHaveLength(1);
		expect((await store.list('encryption'))[0]?.alg).toBe('RSA-OAEP-512');
	});

	test('a retired key is still listed, so the tokens it signed still verify', async () => {
		const expired = Date.now() - 1000;
		await store.create('signing', key({ expired }));

		const [found] = await store.list('signing');
		expect(found?.expired).toBe(expired);
	});

	test('writing the same key id twice is not an error and does not duplicate it', async () => {
		const k = key();
		await store.create('signing', k);
		await store.create('signing', k);

		expect(await store.list('signing')).toHaveLength(1);
	});
});
