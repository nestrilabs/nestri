import { afterAll, describe, expect, test } from 'bun:test';

import { AccessToken } from '@nestri/core/access-token/index';
import { Box } from '@nestri/core/box/index';
import { Fixtures } from '@nestri/core/db/fixtures';
import { testDb } from '@nestri/core/db/test';
import { Env } from '@nestri/core/env';
import { Identifier } from '@nestri/core/id';
import { Machine } from '@nestri/core/machine/index';
import { Team } from '@nestri/core/team/index';

import { app } from '../app/index';
import { TEST_FRONTEND_URL } from './setup';

const sql = testDb();
const createdUserIds: string[] = [];
const createdOrgIds: string[] = [];

const V710 = { model: 'AMD Radeon Pro V710', vramMib: 28672, pciId: '1002:7461' };
const BIG = { model: 'NVIDIA H100', vramMib: 81920, pciId: '10de:2330' };

function useFleet(organisationId: string, entry?: string) {
	Env.init({
		NODE_ENV: 'test',
		FRONTEND_URL: TEST_FRONTEND_URL,
		FLEET_ORGANISATION_ID: organisationId,
		...(entry !== undefined ? { FLEET_ENTRY_GPUS: entry } : {})
	});
}

async function person(label: string, plan?: 'paid') {
	const owner = await Fixtures.owner(label);
	createdUserIds.push(owner.userId);
	if (plan) {
		await Team.setPlan({ id: owner.teamId, plan, subscriptionStatus: 'active' });
	}
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

async function fleet(gpusPerMachine: (typeof V710)[][]) {
	const operator = await Fixtures.owner('operator');
	createdUserIds.push(operator.userId);
	const f = await Fixtures.fleet(operator, gpusPerMachine.length);
	createdOrgIds.push(f.organisationId);
	for (const [i, gpus] of gpusPerMachine.entries()) {
		await Machine.setGpus({ id: f.machines[i]!.id, gpus });
	}
	useFleet(f.organisationId);
	return f;
}

const post = (headers: Record<string, string>, body: object) =>
	app.request('/box', { method: 'POST', headers, body: JSON.stringify(body) });
const json = async (res: Response) => (await res.json()) as any;

afterAll(async () => {
	await sql`delete from session where box_id in (select id from box where user_id = any(${createdUserIds}))`;
	await sql`delete from box where user_id = any(${createdUserIds})`;
	await sql`delete from install_token where created_by_user_id = any(${createdUserIds})`;
	await sql`delete from machine where owner_user_id = any(${createdUserIds})`;
	await sql`delete from organisation where id = any(${createdOrgIds})`;
	await sql`delete from "user" where id = any(${createdUserIds})`;
});

describe('GET /location', () => {
	test('lists your own GPUs one by one and the fleet grouped by model, per your plan', async () => {
		await fleet([[V710], [V710], [BIG]]);
		const free = await person('loc-free');
		const host = await Fixtures.machine(free.owner, 'loc-host');
		await Machine.setGpus({
			id: host,
			gpus: [
				{ model: 'NVIDIA GeForce RTX 3060', vramMib: 12288, pciId: '10de:2503' },
				{ model: 'AMD Radeon RX 9060 XT', vramMib: 16304, pciId: '1002:7590' }
			]
		});

		const res = await app.request('/location', { headers: free.headers });
		expect(res.status).toBe(200);
		const { data } = await json(res);
		expect(data.own.map((o: any) => [o.machineId, o.pciId, o.model, o.vramMib, o.online])).toEqual([
			[host, '10de:2503', 'NVIDIA GeForce RTX 3060', 12288, false],
			[host, '1002:7590', 'AMD Radeon RX 9060 XT', 16304, false]
		]);
		expect(data.fleet).toEqual([
			{ model: V710.model, vramMib: 28672, available: true, entry: true, allowed: true },
			{ model: BIG.model, vramMib: 81920, available: true, entry: false, allowed: false }
		]);

		const pro = await person('loc-pro', 'paid');
		const proFleet = (await json(await app.request('/location', { headers: pro.headers }))).data
			.fleet;
		expect(proFleet.every((f: any) => f.allowed)).toBe(true);
		expect(proFleet.find((f: any) => f.model === BIG.model).entry).toBe(false);
	});

	test('a model with every card taken is listed as not available', async () => {
		await fleet([[V710]]);
		const p = await person('loc-taken');
		expect((await post(p.headers, { on: 'fleet', model: V710.model })).status).toBe(201);
		const other = await person('loc-other', 'paid');
		const { data } = await json(await app.request('/location', { headers: other.headers }));
		expect(data.fleet[0].available).toBe(false);
	});
});

describe('POST /box on a chosen GPU', () => {
	test('an own room is pinned to the chosen GPU; several own hosts are fine', async () => {
		const p = await person('own-gpu');
		const a = await Fixtures.machine(p.owner, 'host-a');
		const b = await Fixtures.machine(p.owner, 'host-b');
		await Machine.setGpus({ id: a, gpus: [V710] });
		await Machine.setGpus({ id: b, gpus: [BIG, V710] });

		const res = await post(p.headers, { on: 'own', machineId: b, pciId: BIG.pciId });
		expect(res.status).toBe(201);
		const box = (await json(res)).data;
		expect(box.machineId).toBe(b);
		expect(box.gpuPciId).toBe(BIG.pciId);
		expect((await Box.fromID(box.id))!.gpuPciId).toBe(BIG.pciId);

		// Own rooms are never counted against a plan.
		for (let i = 0; i < 4; i++) {
			expect((await post(p.headers, { on: 'own', machineId: a, pciId: V710.pciId })).status).toBe(
				201
			);
		}
	});

	test('an own room needs a GPU the host reports, on a host that is yours', async () => {
		const p = await person('own-bad');
		const stranger = await person('own-stranger');
		const mine = await Fixtures.machine(p.owner, 'mine');
		const theirs = await Fixtures.machine(stranger.owner, 'theirs');
		await Machine.setGpus({ id: mine, gpus: [V710] });
		await Machine.setGpus({ id: theirs, gpus: [V710] });

		expect((await post(p.headers, { on: 'own', machineId: mine, pciId: BIG.pciId })).status).toBe(
			404
		);
		expect((await post(p.headers, { on: 'own', machineId: theirs, pciId: V710.pciId })).status).toBe(
			404
		);
		expect((await post(p.headers, { on: 'own', machineId: mine })).status).toBe(400);
	});

	test('the old body still works: one host, no GPU named', async () => {
		const p = await person('old-body');
		const host = await Fixtures.machine(p.owner, 'old');
		const res = await post(p.headers, { label: 'den' });
		expect(res.status).toBe(201);
		const box = (await json(res)).data;
		expect(box.machineId).toBe(host);
		expect(box.gpuPciId).toBeNull();
	});

	test('a fleet room is found by the name a client shows, without the vendor', async () => {
		await fleet([[V710]]);
		const p = await person('fleet-short-name', 'paid');
		const res = await post(p.headers, { on: 'fleet', model: 'Radeon Pro V710' });
		expect(res.status).toBe(201);
		expect((await json(res)).data.gpuPciId).toBe(V710.pciId);
	});

	test('a box is named by the card it is pinned to, not its host\'s first card', async () => {
		const p = await person('pinned-name');
		const host = await Fixtures.machine(p.owner, 'two-cards');
		await Machine.setGpus({ id: host, gpus: [BIG, V710] });
		const res = await post(p.headers, { on: 'own', machineId: host, pciId: V710.pciId });
		expect(res.status).toBe(201);
		const listed = (await json(await app.request('/box', { headers: p.headers }))).data;
		expect(listed.find((b: { machineId: string }) => b.machineId === host).gpu).toBe(V710.model);
	});

	test('a fleet room is placed by model on the least-loaded machine with one free', async () => {
		const f = await fleet([[V710], [V710]]);
		const a = await person('fleet-model-a');
		const b = await person('fleet-model-b');
		const boxA = (await json(await post(a.headers, { on: 'fleet', model: V710.model }))).data;
		const boxB = (await json(await post(b.headers, { on: 'fleet', model: V710.model }))).data;
		expect(boxA.gpuPciId).toBe(V710.pciId);
		expect(new Set([boxA.machineId, boxB.machineId])).toEqual(new Set(f.machines.map((m) => m.id)));

		// Both cards are now taken.
		const c = await person('fleet-model-c');
		expect((await post(c.headers, { on: 'fleet', model: V710.model })).status).toBe(429);
	});

	test('free: one cloud room, entry models only', async () => {
		await fleet([[V710], [BIG], [V710]]);
		const p = await person('free-limits');

		const big = await post(p.headers, { on: 'fleet', model: BIG.model });
		expect(big.status).toBe(403);
		const refusal = await json(big);
		expect(refusal.code).toBe('gpu_needs_pro');
		expect(refusal.message).toBe(`Upgrade to create a room on ${BIG.model}`);

		expect((await post(p.headers, { on: 'fleet', model: V710.model })).status).toBe(201);
		const second = await post(p.headers, { on: 'fleet', model: V710.model });
		expect(second.status).toBe(403);
		const limit = await json(second);
		expect(limit.code).toBe('room_limit');
		expect(limit.message).toBe(`Upgrade to create a room on ${V710.model}`);

		// Your own GPU is still open at the limit.
		const host = await Fixtures.machine(p.owner, 'free-own');
		await Machine.setGpus({ id: host, gpus: [BIG] });
		expect((await post(p.headers, { on: 'own', machineId: host, pciId: BIG.pciId })).status).toBe(
			201
		);
	});

	test('pro: three cloud rooms on any model, then room_limit', async () => {
		await fleet([[BIG], [BIG], [BIG], [BIG]]);
		const p = await person('pro-limits', 'paid');
		for (let i = 0; i < 3; i++) {
			const res = await post(p.headers, { on: 'fleet', model: BIG.model });
			expect(res.status).toBe(201);
		}
		const over = await post(p.headers, { on: 'fleet', model: BIG.model });
		expect(over.status).toBe(403);
		expect((await json(over)).code).toBe('room_limit');

		const billing = await json(await app.request('/billing', { headers: p.headers }));
		expect(billing.data.plan).toBe('paid');
		expect(billing.data.rooms).toEqual({ used: 3, allowed: 3 });
	});

	test('the entry list is configuration', async () => {
		const f = await fleet([[BIG]]);
		useFleet(f.organisationId, 'h100');
		const p = await person('entry-config');
		expect((await post(p.headers, { on: 'fleet', model: BIG.model })).status).toBe(201);
	});
});

describe('GET /billing', () => {
	test('answers plan and rooms, with no windows', async () => {
		await fleet([[V710]]);
		const p = await person('billing-shape');
		const { data } = await json(await app.request('/billing', { headers: p.headers }));
		expect(Object.keys(data).sort()).toEqual(['plan', 'rooms', 'teamId']);
		expect(data.rooms).toEqual({ used: 0, allowed: 1 });
	});
});

describe('the idle limit', () => {
	test('a cloud room with nothing live for 3 hours is stopped, and its record stays', async () => {
		const f = await fleet([[V710]]);
		const p = await person('idle');
		const box = (await json(await post(p.headers, { on: 'fleet', model: V710.model }))).data;
		await Box.setState({ id: box.id, state: 'running' });

		// Fresh: left alone.
		expect(await Box.stopIdle(f.machines[0]!.id)).toEqual([]);

		await sql`update box set time_created = now() - interval '4 hours' where id = ${box.id}`;
		expect(await Box.stopIdle(f.machines[0]!.id)).toEqual([box.id]);
		const after = (await Box.fromID(box.id))!;
		expect(after.state).toBe('stopped');
		expect(after.stopReason).toBe(Box.IDLE_REASON);
	});

	test('your own hardware has no idle limit', async () => {
		const p = await person('idle-own');
		const host = await Fixtures.machine(p.owner, 'idle-own-host');
		const box = (await json(await post(p.headers, { label: 'x' }))).data;
		await Box.setState({ id: box.id, state: 'running' });
		await sql`update box set time_created = now() - interval '9 hours' where id = ${box.id}`;
		expect(await Box.stopIdle(host)).toEqual([]);
		expect((await Box.fromID(box.id))!.state).toBe('running');
	});
});

describe('review blockers on rooms', () => {
	test('free with no model is placed on an entry card only', async () => {
		await fleet([[BIG], [V710]]);
		const p = await person('free-any');
		const res = await post(p.headers, { on: 'fleet' });
		expect(res.status).toBe(201);
		expect((await json(res)).data.gpuPciId).toBe(V710.pciId);

		const only = await fleet([[BIG]]);
		const q = await person('free-none');
		const refused = await post(q.headers, { on: 'fleet' });
		expect(refused.status).toBe(429);
		expect(only.machines.length).toBe(1);
	});

	test('two concurrent POST /box for a free user: exactly one room', async () => {
		await fleet([[V710], [V710], [V710]]);
		const p = await person('race-limit');
		const res = await Promise.all([
			post(p.headers, { on: 'fleet', model: V710.model }),
			post(p.headers, { on: 'fleet', model: V710.model })
		]);
		expect(res.map((r) => r.status).sort()).toEqual([201, 403]);
		expect(await Box.onFleet({ userId: p.owner.userId, organisationId: Env.get().FLEET_ORGANISATION_ID! }))
			.toHaveLength(1);
	});

	test('two people racing for the last card: one gets it', async () => {
		await fleet([[V710]]);
		const a = await person('race-a');
		const b = await person('race-b');
		const res = await Promise.all([
			post(a.headers, { on: 'fleet', model: V710.model }),
			post(b.headers, { on: 'fleet', model: V710.model })
		]);
		expect(res.map((r) => r.status).sort()).toEqual([201, 429]);
	});

	test('a box with no card holds its machine’s first card; slots tell identical cards apart', async () => {
		const f = await fleet([[V710]]);
		const legacy = await person('legacy');
		await Box.create({
			id: Identifier.ascending('box'),
			userId: legacy.owner.userId,
			machineId: f.machines[0]!.id,
			gpuPciId: null,
			label: 'old',
			tier: 'md'
		});
		const other = await person('legacy-other', 'paid');
		expect((await post(other.headers, { on: 'fleet', model: V710.model })).status).toBe(429);
		const loc = (await json(await app.request('/location', { headers: other.headers }))).data;
		expect(loc.fleet[0].available).toBe(false);

		const g = await fleet([[
			{ ...V710, slot: '0000:45:00.0' },
			{ ...V710, slot: '0000:46:00.0' }
		]]);
		const p = await person('slots', 'paid');
		const one = (await json(await post(p.headers, { on: 'fleet', model: V710.model }))).data;
		const two = (await json(await post(p.headers, { on: 'fleet', model: V710.model }))).data;
		expect([one.gpuSlot, two.gpuSlot].sort()).toEqual(['0000:45:00.0', '0000:46:00.0']);
		expect(g.machines.length).toBe(1);
		const jobs = (await import('@nestri/core/session/index')).Session;
		expect(jobs.StartJob.shape.gpuSlot).toBeDefined();
	});

	test('a stopped room whose card was taken is re-placed on the same model, or refused', async () => {
		const f = await fleet([[V710], [V710]]);
		const a = await person('reclaim-a');
		const room = (await json(await post(a.headers, { on: 'fleet', model: V710.model }))).data;
		await Box.setState({ id: room.id, state: 'stopped', stopReason: 'idle for 3 hours', stopClean: true });
		const b = await person('reclaim-b');
		const bBox = (await json(await post(b.headers, { on: 'fleet', model: V710.model }))).data;
		const c = await person('reclaim-c', 'paid');
		const cBox = (await json(await post(c.headers, { on: 'fleet', model: V710.model }))).data;
		expect(cBox.machineId).toBe(room.machineId);
		expect(bBox.machineId).not.toBe(room.machineId);

		const { Placement } = await import('@nestri/core/box/placement');
		await expect(Placement.reclaim(room.id)).rejects.toThrow(/free right now/);
		expect((await Box.fromID(room.id))!.state).toBe('stopped');

		await Box.setState({ id: bBox.id, state: 'stopped', stopReason: 'x', stopClean: true });
		await Placement.reclaim(room.id);
		const moved = (await Box.fromID(room.id))!;
		expect(moved.machineId).toBe(bBox.machineId);
		expect(moved.state).toBe('created');
		expect(f.machines.length).toBe(2);
	});
});
