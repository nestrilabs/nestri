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

	test('a host says where it is on the beat it already sends', async () => {
		const host = await registeredHost('beat-endpoint');
		const endpointId = 'd'.repeat(64);

		// A beat carrying no body is what every agent shipped before this field
		// sends, and it must still be a beat.
		const bare = await app.request('/machine/heartbeat', {
			method: 'POST',
			headers: host.headers
		});
		expect(bare.status).toBe(200);
		expect((await Machine.fromID(host.id))?.endpointId).toBeNull();

		const res = await app.request('/machine/heartbeat', {
			method: 'POST',
			headers: { ...host.headers, 'content-type': 'application/json' },
			body: JSON.stringify({ endpointId })
		});
		expect(res.status).toBe(200);
		expect((await Machine.fromID(host.id))?.endpointId).toBe(endpointId);

		// And a later beat that says nothing does not take the host off the map.
		await app.request('/machine/heartbeat', { method: 'POST', headers: host.headers });
		expect((await Machine.fromID(host.id))?.endpointId).toBe(endpointId);
	});

	test('a host cannot report where somebody else is', async () => {
		// The report is authenticated as the machine it is about, and there is
		// no field naming a different one. This is the assertion that keeps it
		// that way: a body that tries anyway changes nothing.
		const host = await registeredHost('beat-endpoint-other');
		const victim = await registeredHost('beat-endpoint-victim');
		const endpointId = 'e'.repeat(64);

		const res = await app.request('/machine/heartbeat', {
			method: 'POST',
			headers: { ...host.headers, 'content-type': 'application/json' },
			body: JSON.stringify({ endpointId, machineId: victim.id, id: victim.id })
		});

		expect(res.status).toBe(200);
		expect((await Machine.fromID(host.id))?.endpointId).toBe(endpointId);
		expect((await Machine.fromID(victim.id))?.endpointId).toBeNull();
	});

	test('an endpoint id that cannot be one is refused', async () => {
		const host = await registeredHost('beat-endpoint-shape');

		const res = await app.request('/machine/heartbeat', {
			method: 'POST',
			headers: { ...host.headers, 'content-type': 'application/json' },
			body: JSON.stringify({ endpointId: 'not-an-endpoint-id' })
		});

		expect(res.status).toBe(400);
		expect((await Machine.fromID(host.id))?.endpointId).toBeNull();
		// Liveness is still recorded, and that is not a half-applied write:
		// authenticating as this machine is itself proof it is alive, and the
		// middleware records it before any route runs. What the refusal keeps
		// out is the value that failed the check.
		expect((await Machine.fromID(host.id))?.lastSeen).not.toBeNull();
	});

	test('claiming another host’s endpoint id is a conflict, not a fault', async () => {
		const first = await registeredHost('beat-endpoint-taken-a');
		const second = await registeredHost('beat-endpoint-taken-b');
		const endpointId = 'f'.repeat(64);

		await app.request('/machine/heartbeat', {
			method: 'POST',
			headers: { ...first.headers, 'content-type': 'application/json' },
			body: JSON.stringify({ endpointId })
		});

		const res = await app.request('/machine/heartbeat', {
			method: 'POST',
			headers: { ...second.headers, 'content-type': 'application/json' },
			body: JSON.stringify({ endpointId })
		});

		// The unique index is the invariant, so the database refusing is the
		// expected way to find out — and an expected refusal reaching a host as
		// a 500 tells it the server broke rather than that the id is taken.
		expect(res.status).toBe(409);
		expect((await res.json()) as any).toMatchObject({ type: 'already_exists' });
		expect((await Machine.fromID(second.id))?.endpointId).toBeNull();
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
