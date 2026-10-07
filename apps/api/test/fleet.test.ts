import { afterAll, describe, expect, test } from 'bun:test';

import { AccessToken } from '@nestri/core/access-token/index';
import { Box } from '@nestri/core/box/index';
import { Fixtures } from '@nestri/core/db/fixtures';
import { testDb } from '@nestri/core/db/test';
import { Env } from '@nestri/core/env';
import { Game } from '@nestri/core/game/index';
import { Identifier } from '@nestri/core/id';
import { Machine } from '@nestri/core/machine/index';
import { Session } from '@nestri/core/session/index';

import { app } from '../app/index';
import { TEST_FRONTEND_URL } from './setup';

const sql = testDb();
const createdUserIds: string[] = [];
const createdOrgIds: string[] = [];
const createdGameIds: string[] = [];

function useFleet(organisationId?: string) {
	Env.init({
		NODE_ENV: 'test',
		FRONTEND_URL: TEST_FRONTEND_URL,
		...(organisationId ? { FLEET_ORGANISATION_ID: organisationId } : {})
	});
}

async function person(label: string) {
	const owner = await Fixtures.owner(label);
	createdUserIds.push(owner.userId);
	const pat = await AccessToken.create({
		id: Identifier.ascending('accessToken'),
		ownerUserId: owner.userId,
		teamId: null,
		name: label
	});
	return {
		owner,
		headers: {
			authorization: `Bearer ${pat.token}`,
			'content-type': 'application/json'
		} as Record<string, string>
	};
}

async function fleet(hosts: number) {
	const operator = await Fixtures.owner('operator');
	createdUserIds.push(operator.userId);
	const f = await Fixtures.fleet(operator, hosts);
	createdOrgIds.push(f.organisationId);
	return f;
}

function createBox(headers: Record<string, string>, body: object) {
	return app.request('/box', { method: 'POST', headers, body: JSON.stringify(body) });
}

afterAll(async () => {
	await sql`delete from session where box_id in (select id from box where user_id = any(${createdUserIds}))`;
	await sql`delete from box where user_id = any(${createdUserIds})`;
	await sql`delete from game where id = any(${createdGameIds})`;
	await sql`delete from machine where owner_user_id = any(${createdUserIds})`;
	await sql`delete from organisation where id = any(${createdOrgIds})`;
	await sql`delete from "user" where id = any(${createdUserIds})`;
});

describe('POST /box on the fleet', () => {
	test('places on the online fleet machine holding the fewest boxes', async () => {
		const f = await fleet(2);
		useFleet(f.organisationId);
		const [first, second] = f.machines;

		const a = await person('fleet-a');
		const resA = await createBox(a.headers, { on: 'fleet' });
		expect(resA.status).toBe(201);
		const boxA = ((await resA.json()) as any).data;
		expect(boxA.machineId).toBe(first!.id);

		const b = await person('fleet-b');
		const boxB = ((await (await createBox(b.headers, { on: 'fleet' })).json()) as any).data;
		expect(boxB.machineId).toBe(second!.id);
	});

	test('skips a fleet machine that is offline', async () => {
		const f = await fleet(2);
		useFleet(f.organisationId);
		await sql`update machine set last_seen = now() - interval '1 hour' where id = ${f.machines[0]!.id}`;

		const p = await person('fleet-offline');
		const box = ((await (await createBox(p.headers, { on: 'fleet' })).json()) as any).data;
		expect(box.machineId).toBe(f.machines[1]!.id);
	});

	test('no fleet machine online is a 429 that says so', async () => {
		const f = await fleet(1);
		useFleet(f.organisationId);
		await sql`update machine set last_seen = null where id = ${f.machines[0]!.id}`;

		const p = await person('fleet-none');
		const res = await createBox(p.headers, { on: 'fleet' });
		expect(res.status).toBe(429);
		expect(((await res.json()) as any).message).toContain('No Nestri GPU is free');
	});

	test('a deployment with no fleet configured refuses fleet boxes', async () => {
		useFleet();
		const p = await person('fleet-unset');
		const res = await createBox(p.headers, { on: 'fleet' });
		expect(res.status).toBe(500);
		expect(((await res.json()) as any).message).toContain('not available');
	});

	test('one fleet box each: asking again is a 409', async () => {
		const f = await fleet(1);
		useFleet(f.organisationId);
		const p = await person('fleet-twice');
		expect((await createBox(p.headers, { on: 'fleet' })).status).toBe(201);
		const again = await createBox(p.headers, { on: 'fleet' });
		expect(again.status).toBe(409);
		expect((await Box.listByUser(p.owner.userId)).length).toBe(1);
	});

	test('`on` defaults to your own host', async () => {
		const f = await fleet(1);
		useFleet(f.organisationId);
		const p = await person('own-default');
		const machineId = await Fixtures.machine(p.owner);
		const res = await createBox(p.headers, { label: 'mine' });
		expect(res.status).toBe(201);
		expect(((await res.json()) as any).data.machineId).toBe(machineId);
	});
});

describe('Entitlement on a fleet machine', () => {
	test('open during your own run on it, and closed before and after', async () => {
		const f = await fleet(1);
		useFleet(f.organisationId);
		const machineId = f.machines[0]!.id;
		const p = await person('entitle-run');
		const other = await person('entitle-other');
		const box = ((await (await createBox(p.headers, { on: 'fleet' })).json()) as any).data;

		const may = (userId: string) => Machine.entitlement({ machineId, userId });
		expect(await may(p.owner.userId)).toEqual({ entitled: false, reason: 'fleet' });

		const [game] = await Game.upsert({
			id: Identifier.ascending('game'),
			steamAppId: 990001,
			slug: 'fleet-entitle',
			name: 'Fleet Entitle'
		});
		createdGameIds.push(game!.id);
		const run = await Session.request({
			id: Identifier.ascending('session'),
			boxId: box.id,
			gameId: game!.id,
			linkedAccountId: p.owner.linkedAccountId
		});
		await sql`update session set state = 'live' where id = ${run.id}`;

		expect(await may(p.owner.userId)).toEqual({ entitled: true, reason: 'fleet' });
		// Somebody else's run on the same machine grants you nothing.
		expect((await may(other.owner.userId)).entitled).toBe(false);

		await sql`update session set state = 'ended', time_stopped = now() where id = ${run.id}`;
		expect((await may(p.owner.userId)).entitled).toBe(false);
	});
});
