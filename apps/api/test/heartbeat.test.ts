import { afterAll, describe, expect, test } from 'bun:test';

import { Fixtures } from '@nestri/core/db/fixtures';
import { testDb } from '@nestri/core/db/test';
import { Identifier } from '@nestri/core/id';
import { Machine } from '@nestri/core/machine/index';

import { app } from '../app/index';
import './setup';

const sql = testDb();

const createdUserIds: string[] = [];

/**
 * A registered host, with the secret kept — which registration returns exactly
 * once, so a test that needs to authenticate as a machine has to hold onto it
 * here rather than reading it back later.
 */
async function registeredHost(label: string) {
	const owner = await Fixtures.owner(label);
	createdUserIds.push(owner.userId);
	const registered = await Machine.register({
		id: Identifier.ascending('machine'),
		ownerUserId: owner.userId,
		teamId: owner.teamId,
		label
	});
	return {
		id: registered.id,
		headers: {
			'x-nestri-machine-id': registered.id,
			'x-nestri-machine-secret': registered.secret
		}
	};
}

afterAll(async () => {
	if (createdUserIds.length > 0) {
		await sql`delete from "user" where id in ${sql(createdUserIds)}`;
		createdUserIds.length = 0;
	}
});

describe('POST /machine/heartbeat', () => {
	test('a host beats and is told how often to beat again', async () => {
		const host = await registeredHost('beat-ok');

		const res = await app.request('/machine/heartbeat', {
			method: 'POST',
			headers: host.headers
		});
		expect(res.status).toBe(200);

		const body = (await res.json()) as any;
		// These two field names are what a host agent reads out of the reply. A
		// rename on either side produces a host that beats, parses nothing, and
		// reports success — so the names are the contract and this is the test
		// that holds them.
		expect(typeof body.data.lastSeen).toBe('string');
		expect(body.data.intervalSeconds).toBe(Machine.HEARTBEAT_SECONDS);
		expect(new Date(body.data.lastSeen).getTime()).not.toBeNaN();
	});

	test('the beat is what makes the host look online', async () => {
		const host = await registeredHost('beat-online');

		// Before any beat there is nothing to be online on the strength of.
		expect(Machine.isOnline((await Machine.fromID(host.id))?.lastSeen ?? null)).toBe(false);

		await app.request('/machine/heartbeat', { method: 'POST', headers: host.headers });

		expect(Machine.isOnline((await Machine.fromID(host.id))?.lastSeen ?? null)).toBe(true);
	});

	test('wrong credentials are indistinguishable from none', async () => {
		const host = await registeredHost('beat-wrongsecret');

		const none = await app.request('/machine/heartbeat', { method: 'POST' });
		const wrong = await app.request('/machine/heartbeat', {
			method: 'POST',
			headers: { ...host.headers, 'x-nestri-machine-secret': 'msk_wrong' }
		});

		// The middleware falls through to `public` on bad credentials rather
		// than erroring, precisely so probing cannot tell an attacker which
		// machine ids exist. Both therefore fail the same way, and asserting
		// they are *identical* is the only way that property stays true.
		expect(wrong.status).toBe(403);
		expect(none.status).toBe(403);
		expect(await wrong.json()).toEqual(await none.json());

		// And the failed attempt left no trace of having been alive.
		expect((await Machine.fromID(host.id))?.lastSeen).toBeNull();
	});

	test('a user session cannot beat on a host’s behalf', async () => {
		// A box holds credentials but is not its owner, and the reverse holds
		// too: `machineOnly` exists so a route written for a host cannot be
		// driven by whoever owns it.
		const res = await app.request('/machine/heartbeat', {
			method: 'POST',
			headers: { 'x-nestri-admin-token': 'test-admin-secret-42' }
		});
		expect(res.status).toBe(403);
	});
});
