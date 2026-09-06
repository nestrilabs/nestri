import { afterAll, describe, expect, test } from 'bun:test';

import { Fixtures } from '@nestri/core/db/fixtures';
import { testDb } from '@nestri/core/db/test';
import { Identifier } from '@nestri/core/id';
import { Machine } from '@nestri/core/machine/index';

import { app } from '../app/index';
import { TEST_ADMIN_SECRET } from './setup';
import './setup';

const sql = testDb();

const createdUserIds: string[] = [];

/** A Steam ID is 17 digits; these are distinct and obviously not real. */
function steamId(n: number) {
	return `765611980000${String(n).padStart(5, '0')}`;
}

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
		userId: owner.userId,
		headers: {
			'x-nestri-machine-id': registered.id,
			'x-nestri-machine-secret': registered.secret,
			'content-type': 'application/json'
		}
	};
}

function enrol(host: { headers: Record<string, string> }, body: unknown) {
	return app.request('/machine/enrolment', {
		method: 'POST',
		headers: host.headers,
		body: JSON.stringify(body)
	});
}

function markStale(host: { headers: Record<string, string> }, body: unknown) {
	return app.request('/machine/enrolment/stale', {
		method: 'POST',
		headers: host.headers,
		body: JSON.stringify(body)
	});
}

function list(host: { headers: Record<string, string> }) {
	return app.request('/machine/enrolment', { headers: host.headers });
}

afterAll(async () => {
	if (createdUserIds.length > 0) {
		await sql`delete from "user" where id in ${sql(createdUserIds)}`;
		createdUserIds.length = 0;
	}
});

describe('POST /machine/enrolment', () => {
	test('the outcome is recorded and `data` is the enrolment itself', async () => {
		const host = await registeredHost('enrol-shape');

		const res = await enrol(host, { userId: host.userId, steamId: steamId(1) });
		expect(res.status).toBe(200);

		const body = (await res.json()) as any;
		// `data` is the object, not `{"data": {"enrolment": …}}`. A host written
		// against the wrapped form parses nothing, and finds out on first
		// contact rather than in review.
		expect(body.data).toMatchObject({
			machineId: host.id,
			userId: host.userId,
			steamId: steamId(1),
			state: 'enrolled'
		});
		expect(Object.keys(body.data).sort()).toEqual(
			['enrolledAt', 'lastOkAt', 'machineId', 'revokedAt', 'state', 'steamId', 'userId'].sort()
		);
		expect(body.data.enrolment).toBeUndefined();
		// camelCase on the wire, always. The snake-to-camel seam is where a
		// host and a control plane silently stop understanding each other.
		for (const key of Object.keys(body.data)) {
			expect(key).not.toContain('_');
		}
		expect(typeof body.data.enrolledAt).toBe('string');
		expect(body.data.lastOkAt).toBeNull();
		expect(body.data.revokedAt).toBeNull();
	});

	test('the machine is taken from the credentials, never the body', async () => {
		const host = await registeredHost('enrol-self');
		const other = await registeredHost('enrol-other');

		// A host naming another host would be a host enrolling somebody else's
		// hardware. There is no field for it, so this is a validation error.
		const res = await enrol(host, {
			userId: host.userId,
			steamId: steamId(2),
			machineId: other.id
		});
		expect(res.status).toBe(400);

		const still = await list(other);
		expect(((await still.json()) as any).data).toEqual([]);
	});

	test('re-enrolling keeps the first `enrolledAt` and adopts the new Steam account', async () => {
		const host = await registeredHost('enrol-again');

		const first = (await (
			await enrol(host, { userId: host.userId, steamId: steamId(3) })
		).json()) as any;
		const second = (await (
			await enrol(host, { userId: host.userId, steamId: steamId(4) })
		).json()) as any;

		expect(second.data.enrolledAt).toBe(first.data.enrolledAt);
		expect(second.data.steamId).toBe(steamId(4));
		expect(second.data.state).toBe('enrolled');
	});

	test('one Steam account on two hosts is two enrolments', async () => {
		// Two hosts, two tokens, two rows — the whole reason the Steam id is
		// not unique across machines. A unique index there would read as
		// hygiene and would refuse the second host.
		const first = await registeredHost('enrol-two-a');
		const second = await registeredHost('enrol-two-b');
		const shared = steamId(5);

		expect((await enrol(first, { userId: first.userId, steamId: shared })).status).toBe(200);
		expect((await enrol(second, { userId: second.userId, steamId: shared })).status).toBe(200);

		const a = ((await (await list(first)).json()) as any).data;
		const b = ((await (await list(second)).json()) as any).data;
		expect(a).toHaveLength(1);
		expect(b).toHaveLength(1);
		expect(a[0].machineId).toBe(first.id);
		expect(b[0].machineId).toBe(second.id);
	});

	test('a user nobody has heard of is refused rather than crashing', async () => {
		const host = await registeredHost('enrol-ghost');
		const res = await enrol(host, { userId: 'usr_nosuchuseratall', steamId: steamId(6) });
		expect(res.status).toBe(404);
		const body = (await res.json()) as any;
		expect(body.type).toBe('not_found');
	});

	test('a Steam id has to look like one', async () => {
		const host = await registeredHost('enrol-badsteam');
		const res = await enrol(host, { userId: host.userId, steamId: 'not-a-steam-id' });
		expect(res.status).toBe(400);
	});

	test('machine credentials are required', async () => {
		const res = await app.request('/machine/enrolment', {
			method: 'POST',
			headers: { 'x-nestri-admin-token': TEST_ADMIN_SECRET, 'content-type': 'application/json' },
			body: JSON.stringify({ userId: 'usr_x', steamId: steamId(7) })
		});
		expect(res.status).toBe(403);
		expect(((await res.json()) as any).message).toContain('Machine credentials');
	});
});

describe('POST /machine/enrolment/stale', () => {
	test('a refused token moves the enrolment to stale', async () => {
		const host = await registeredHost('stale-happy');
		await enrol(host, { userId: host.userId, steamId: steamId(8) });

		const res = await markStale(host, { userId: host.userId });
		expect(res.status).toBe(200);
		const body = (await res.json()) as any;
		expect(body.data.state).toBe('stale');
		expect(body.data.userId).toBe(host.userId);
	});

	test('re-enrolling after a refusal returns the row to enrolled', async () => {
		const host = await registeredHost('stale-recover');
		await enrol(host, { userId: host.userId, steamId: steamId(9) });
		await markStale(host, { userId: host.userId });

		const again = (await (
			await enrol(host, { userId: host.userId, steamId: steamId(9) })
		).json()) as any;
		expect(again.data.state).toBe('enrolled');
	});

	test('an enrolment this host does not have is a 404', async () => {
		const host = await registeredHost('stale-missing');
		const res = await markStale(host, { userId: host.userId });
		expect(res.status).toBe(404);
		expect(((await res.json()) as any).type).toBe('not_found');
	});

	test('a host cannot mark another host’s enrolment stale', async () => {
		const owner = await registeredHost('stale-owner');
		const stranger = await registeredHost('stale-stranger');
		await enrol(owner, { userId: owner.userId, steamId: steamId(10) });

		// Scoped to the calling machine, so somebody else's row is simply not
		// there — a miss, not a permission check that could be forgotten.
		const res = await markStale(stranger, { userId: owner.userId });
		expect(res.status).toBe(404);

		const untouched = ((await (await list(owner)).json()) as any).data;
		expect(untouched[0].state).toBe('enrolled');
	});

	test('machine credentials are required', async () => {
		const res = await app.request('/machine/enrolment/stale', {
			method: 'POST',
			headers: { 'x-nestri-admin-token': TEST_ADMIN_SECRET, 'content-type': 'application/json' },
			body: JSON.stringify({ userId: 'usr_x' })
		});
		expect(res.status).toBe(403);
	});
});

describe('GET /machine/enrolment', () => {
	test('a host with no enrolments gets an empty list, not a 404', async () => {
		const host = await registeredHost('list-empty');
		const res = await list(host);
		expect(res.status).toBe(200);
		expect(((await res.json()) as any).data).toEqual([]);
	});

	test('every enrolment this host is expected to hold, and no other host’s', async () => {
		const host = await registeredHost('list-mine');
		const other = await registeredHost('list-theirs');
		await enrol(host, { userId: host.userId, steamId: steamId(11) });
		await enrol(other, { userId: other.userId, steamId: steamId(12) });

		const res = await list(host);
		expect(res.status).toBe(200);
		const body = (await res.json()) as any;
		// `data` is the list itself.
		expect(Array.isArray(body.data)).toBe(true);
		expect(body.data).toHaveLength(1);
		expect(body.data[0].machineId).toBe(host.id);
	});

	test('machine credentials are required', async () => {
		const res = await app.request('/machine/enrolment', {
			headers: { 'x-nestri-admin-token': TEST_ADMIN_SECRET }
		});
		expect(res.status).toBe(403);
	});
});

describe('The enrolment surface refuses a token', () => {
	// The token lives on the host and nowhere else. There is no endpoint that
	// accepts a refresh token, a challenge URL or a client id, and the way that
	// stays true is a test that fails the moment somebody adds one.

	const forbidden = [
		{ refreshToken: 'eyJ.not.a.real.one' },
		{ token: 'anything' },
		{ accessToken: 'anything' },
		{ challengeUrl: 'https://s.team/q/1/2' },
		{ clientId: '1234567890' }
	];

	test('POST /machine/enrolment rejects every credential-shaped field', async () => {
		const host = await registeredHost('refuse-token-enrol');
		for (const extra of forbidden) {
			// eslint-disable-next-line no-await-in-loop
			const res = await enrol(host, {
				userId: host.userId,
				steamId: steamId(13),
				...extra
			});
			expect(res.status).toBe(400);
			// eslint-disable-next-line no-await-in-loop
			expect(((await res.json()) as any).type).toBe('validation');
		}
	});

	test('POST /machine/enrolment/stale rejects every credential-shaped field', async () => {
		const host = await registeredHost('refuse-token-stale');
		await enrol(host, { userId: host.userId, steamId: steamId(14) });
		for (const extra of forbidden) {
			// eslint-disable-next-line no-await-in-loop
			const res = await markStale(host, { userId: host.userId, ...extra });
			expect(res.status).toBe(400);
		}
	});

	test('the published surface has exactly three enrolment routes and no field for a credential', async () => {
		const res = await app.request('/doc');
		const doc = (await res.json()) as any;

		function resolve(schema: any): any {
			if (schema?.$ref) {
				const name = String(schema.$ref).split('/').pop()!;
				return resolve(doc.components?.schemas?.[name]);
			}
			return schema;
		}

		function propertyNames(schema: any): string[] {
			const s = resolve(schema);
			if (!s) return [];
			const own = Object.keys(s.properties ?? {});
			const composed = [...(s.allOf ?? []), ...(s.anyOf ?? []), ...(s.oneOf ?? [])].flatMap(
				propertyNames
			);
			return [...own, ...composed];
		}

		const paths = Object.keys(doc.paths).filter((p) => p.startsWith('/machine/enrolment'));
		expect(paths.sort()).toEqual(['/machine/enrolment', '/machine/enrolment/stale']);

		const accepted = new Set<string>();
		for (const path of paths) {
			for (const operation of Object.values<any>(doc.paths[path])) {
				for (const parameter of operation.parameters ?? []) {
					accepted.add(parameter.name);
				}
				const schema = operation.requestBody?.content?.['application/json']?.schema;
				if (schema) {
					for (const name of propertyNames(schema)) {
						accepted.add(name);
					}
				}
			}
		}

		// Not "contains no token" — an exact set. Anything new on this surface
		// has to be argued for here, which is the point.
		expect([...accepted].sort()).toEqual(['steamId', 'userId']);
	});
});
