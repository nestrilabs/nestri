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
	await sql`delete from burn_segment where session_id in (select s.id from session s join box b on b.id = s.box_id where b.user_id = any(${createdUserIds}))`;
	await sql`delete from session where box_id in (select id from box where user_id = any(${createdUserIds}))`;
	await sql`delete from box where user_id = any(${createdUserIds})`;
	await sql`delete from game where id = any(${createdGameIds})`;
	await sql`delete from install_token where created_by_user_id = any(${createdUserIds})`;
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

describe('Billing a run on the fleet', () => {
	test('a live fleet run accrues against the box owner’s personal team', async () => {
		const f = await fleet(1);
		useFleet(f.organisationId);
		const machineId = f.machines[0]!.id;
		const p = await person('bill-fleet');
		const box = ((await (await createBox(p.headers, { on: 'fleet' })).json()) as any).data;

		const [game] = await Game.upsert({
			id: Identifier.ascending('game'),
			steamAppId: 990002,
			slug: 'fleet-bill',
			name: 'Fleet Bill'
		});
		createdGameIds.push(game!.id);
		const run = await Session.request({
			id: Identifier.ascending('session'),
			boxId: box.id,
			gameId: game!.id,
			linkedAccountId: p.owner.linkedAccountId
		});
		const claimToken = 'fleet-bill-claim-token-0001';
		for (const state of ['starting', 'live'] as const) {
			const r = await Session.transition({ id: run.id, machineId, state, claimToken });
			expect(r.outcome).toBe('moved');
		}

		const open = await sql`select team_id, ended_at from burn_segment where session_id = ${run.id}`;
		expect(open.length).toBe(1);
		expect(open[0]!.team_id).toBe(p.owner.teamId);
		expect(open[0]!.ended_at).toBeNull();

		await Session.transition({ id: run.id, machineId, state: 'ended', claimToken });
		const closed = await sql`select ended_at from burn_segment where session_id = ${run.id}`;
		expect(closed[0]!.ended_at).not.toBeNull();
	});
});

describe('An install token for the fleet', () => {
	async function member(domain: string, organisationId: string) {
		const userId = Identifier.ascending('user');
		await sql`insert into "user" (id, name, email, email_verified) values (${userId}, 'staff', ${'staff@' + domain}, true)`;
		createdUserIds.push(userId);
		const pat = await AccessToken.create({
			id: Identifier.ascending('accessToken'),
			ownerUserId: userId,
			teamId: null,
			name: 'staff'
		});
		return {
			userId,
			organisationId,
			headers: { authorization: `Bearer ${pat.token}`, 'content-type': 'application/json' }
		};
	}

	async function org() {
		const id = Identifier.ascending('organisation');
		const domain = `${id.slice(-10).toLowerCase()}.example.test`;
		await sql`insert into organisation (id, name, slug, domain, domain_verified)
			values (${id}, 'Fleet', ${'fleet-' + id.slice(-10).toLowerCase()}, ${domain}, true)`;
		createdOrgIds.push(id);
		return { id, domain };
	}

	test('a member mints one, and the host it registers belongs to the fleet', async () => {
		const o = await org();
		const staff = await member(o.domain, o.id);
		const minted = await app.request('/machine/install-token', {
			method: 'POST',
			headers: staff.headers,
			body: JSON.stringify({ organisationId: o.id })
		});
		expect(minted.status).toBe(200);
		const { token } = ((await minted.json()) as any).data;

		const installed = await app.request('/machine/install', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ token, label: 'fleet-host' })
		});
		expect(installed.status).toBe(200);
		const { machineId } = ((await installed.json()) as any).data;
		const machine = await Machine.fromID(machineId);
		expect(machine?.organisationId).toBe(o.id);
		expect(machine?.teamId).toBeNull();
	});

	test('somebody outside the organisation is refused', async () => {
		const o = await org();
		const outsider = await person('fleet-outsider');
		const res = await app.request('/machine/install-token', {
			method: 'POST',
			headers: outsider.headers,
			body: JSON.stringify({ organisationId: o.id })
		});
		expect(res.status).toBe(403);
	});

	test('naming a team and an organisation is a 400', async () => {
		const o = await org();
		const staff = await member(o.domain, o.id);
		const res = await app.request('/machine/install-token', {
			method: 'POST',
			headers: staff.headers,
			body: JSON.stringify({ organisationId: o.id, teamId: 'tem_whatever' })
		});
		expect(res.status).toBe(400);
	});
});
