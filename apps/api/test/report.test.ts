import { afterAll, describe, expect, test } from 'bun:test';

import { Box } from '@nestri/core/box/index';
import { Fixtures } from '@nestri/core/db/fixtures';
import { testDb } from '@nestri/core/db/test';
import { Identifier } from '@nestri/core/id';
import { Machine } from '@nestri/core/machine/index';

import { app } from '../app/index';
import './setup';

const sql = testDb();

const createdUserIds: string[] = [];

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

async function boxOn(host: { id: string; userId: string }, label: string) {
	return Box.create({
		id: Identifier.ascending('box'),
		userId: host.userId,
		machineId: host.id,
		label,
		tier: 'sm'
	});
}

function report(host: { headers: Record<string, string> }, body: unknown) {
	return app.request('/machine/report', {
		method: 'POST',
		headers: host.headers,
		body: JSON.stringify(body)
	});
}

afterAll(async () => {
	if (createdUserIds.length > 0) {
		await sql`delete from "box" where user_id in ${sql(createdUserIds)}`;
		await sql`delete from "user" where id in ${sql(createdUserIds)}`;
		createdUserIds.length = 0;
	}
});

describe('POST /machine/report', () => {
	test('the body is the shape the agent sends, flat and camelCased', async () => {
		const host = await registeredHost('report-shape');
		const running = await boxOn(host, 'one');
		const idle = await boxOn(host, 'two');

		// Written from the contract and not from the handler: host fields flat at
		// the top, boxes under `boxes`, the lifecycle tag flattened into each box,
		// and `uptimeS` rather than `uptime_s`. A rename on either side of this
		// seam produces a host that reports, is understood by nothing, and is
		// told it succeeded.
		const res = await report(host, {
			agentPid: 4711,
			boxesKnown: 2,
			boxesRunning: 1,
			boxes: [
				{ boxId: running.id, tier: 'sm', state: 'running', pid: 1234, uptimeS: 45 },
				{ boxId: idle.id, tier: 'sm', state: 'created' }
			]
		});

		expect(res.status).toBe(200);
		const body = (await res.json()) as any;
		expect(body.data.recorded).toBe(2);
		expect(body.data.unknown).toEqual([]);
		expect((await Box.fromID(running.id))!.state).toBe('running');
	});

	test('a request is not wrapped in an envelope, but the response is', async () => {
		const host = await registeredHost('report-envelope');

		const wrapped = await report(host, {
			data: { agentPid: 1, boxesKnown: 0, boxesRunning: 0, boxes: [] }
		});
		expect(wrapped.status).toBe(400);

		const flat = await report(host, {
			agentPid: 1,
			boxesKnown: 0,
			boxesRunning: 0,
			boxes: []
		});
		expect(flat.status).toBe(200);
		expect(await flat.json()).toHaveProperty('data');
	});

	test('a stop carries its reason all the way to the row', async () => {
		const host = await registeredHost('report-stop');
		const box = await boxOn(host, 'faulty');

		await report(host, {
			agentPid: 1,
			boxesKnown: 1,
			boxesRunning: 0,
			boxes: [
				{ boxId: box.id, tier: 'sm', state: 'stopped', reason: 'guest exited 1', clean: false }
			]
		});

		const row = (await Box.fromID(box.id))!;
		expect(row.state).toBe('stopped');
		expect(row.stopReason).toBe('guest exited 1');
		expect(row.stopClean).toBe(false);
	});

	test('a host cannot report on another host’s boxes', async () => {
		// The access rule that matters here. A machine credential is a long-lived
		// secret on hardware in somebody's living room, so the scope is in the
		// query and not in the agent asking politely about its own boxes.
		const mine = await registeredHost('report-mine');
		const theirs = await registeredHost('report-theirs');
		const victim = await boxOn(theirs, 'not yours');
		await Box.setState({ id: victim.id, state: 'running' });

		const res = await report(mine, {
			agentPid: 1,
			boxesKnown: 1,
			boxesRunning: 1,
			boxes: [{ boxId: victim.id, tier: 'sm', state: 'stopped', reason: 'mine now', clean: false }]
		});

		expect(res.status).toBe(200);
		expect(((await res.json()) as any).data.unknown).toEqual([victim.id]);
		expect((await Box.fromID(victim.id))!.state).toBe('running');
	});

	test('a field nobody can act on is refused rather than dropped', async () => {
		const host = await registeredHost('report-strict');

		// Capacity belongs on this call eventually and has no honest fields yet.
		// Refusing an invented one is how an unmeasured number stays out of a
		// record a placement decision will one day read.
		const res = await report(host, {
			agentPid: 1,
			boxesKnown: 0,
			boxesRunning: 0,
			boxes: [],
			gpusFree: 4
		});
		expect(res.status).toBe(400);
	});

	test('wrong credentials are indistinguishable from none', async () => {
		const host = await registeredHost('report-wrongsecret');
		const body = JSON.stringify({ agentPid: 1, boxesKnown: 0, boxesRunning: 0, boxes: [] });

		const none = await app.request('/machine/report', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body
		});
		const wrong = await app.request('/machine/report', {
			method: 'POST',
			headers: { ...host.headers, 'x-nestri-machine-secret': 'msk_wrong' },
			body
		});

		expect(wrong.status).toBe(403);
		expect(none.status).toBe(403);
		expect(await wrong.json()).toEqual(await none.json());
	});
});
