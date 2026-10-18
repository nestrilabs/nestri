import { afterAll, describe, expect, test } from 'bun:test';

import { AccessToken } from '@nestri/core/access-token/index';
import { Box } from '@nestri/core/box/index';
import { Fixtures } from '@nestri/core/db/fixtures';
import { testDb } from '@nestri/core/db/test';
import { Game } from '@nestri/core/game/index';
import { Identifier } from '@nestri/core/id';
import { Machine } from '@nestri/core/machine/index';
import { Session } from '@nestri/core/session/index';
import { JobWake } from '@nestri/core/session/wake';
import { Library } from '@nestri/core/user/library';
import { LinkedAccount } from '@nestri/core/user/linked-account';

import { app } from '../app/index';
import './setup';

const sql = testDb();

const HOLDER = 'h'.repeat(32);

const createdUserIds: string[] = [];
const createdGameIds: string[] = [];

async function newGame(steamAppId: number): Promise<string> {
	const [row] = await Game.upsert({
		id: Identifier.ascending('game'),
		steamAppId,
		slug: `session-route-${steamAppId}`,
		name: `Session Route ${steamAppId}`
	});
	if (!row) throw new Error('expected a game row');
	createdGameIds.push(row.id);
	return row.id;
}

/**
 * Everything one session needs, plus both sets of credentials that reach it.
 *
 * The person authenticates with a personal token, which is the one user
 * credential a test can mint without an auth service; the host authenticates
 * as itself with the secret registration hands back exactly once.
 */
async function scene(label: string, steamAppId: number) {
	const owner = await Fixtures.owner(label);
	createdUserIds.push(owner.userId);

	const registered = await Machine.register({
		id: Identifier.ascending('machine'),
		ownerUserId: owner.userId,
		teamId: owner.teamId,
		label
	});

	const box = await Box.create({
		id: Identifier.ascending('box'),
		userId: owner.userId,
		machineId: registered.id,
		label,
		tier: 'sm'
	});

	const pat = await AccessToken.create({
		id: Identifier.ascending('accessToken'),
		ownerUserId: owner.userId,
		// Null on purpose: a token scoped to the user alone makes the caller a
		// plain user actor, which is the credential a person browsing has.
		teamId: null,
		name: label
	});

	const gameId = await newGame(steamAppId);
	// A run launches as a Steam account that owns the game, so the endpoint
	// refuses one outside the caller's library. Every scene here is about
	// something else, so the game is stocked.
	await Library.upsert({
		id: Identifier.ascending('userLibrary'),
		userId: owner.userId,
		gameId,
		playtime2w: null,
		playtimeForever: null,
		lastPlayed: null
	});

	return {
		owner,
		box,
		machineId: registered.id,
		gameId,
		user: {
			authorization: `Bearer ${pat.token}`,
			'content-type': 'application/json'
		} as Record<string, string>,
		host: {
			'x-nestri-machine-id': registered.id,
			'x-nestri-machine-secret': registered.secret,
			'content-type': 'application/json'
		} as Record<string, string>
	};
}

async function requestSession(s: Awaited<ReturnType<typeof scene>>) {
	const res = await app.request('/session', {
		method: 'POST',
		headers: s.user,
		body: JSON.stringify({
			boxId: s.box.id,
			gameId: s.gameId,
			linkedAccountId: s.owner.linkedAccountId
		})
	});
	const body = (await res.json()) as any;
	return { res, body };
}

afterAll(async () => {
	if (createdUserIds.length > 0) {
		await sql`delete from "burn_segment" where session_id in (
			select s.id from "session" s
			join "box" b on b.id = s.box_id
			where b.user_id in ${sql(createdUserIds)}
		)`;
		await sql`delete from "box" where user_id in ${sql(createdUserIds)}`;
		await sql`delete from "user" where id in ${sql(createdUserIds)}`;
	}
	if (createdGameIds.length > 0) {
		await sql`delete from "game" where id in ${sql(createdGameIds)}`;
	}
});

type Scene = Awaited<ReturnType<typeof scene>>;

const report = (s: Scene, id: string, state: string, extra: object = {}) =>
	app.request(`/session/${id}/state`, {
		method: 'POST',
		headers: s.host,
		body: JSON.stringify({ state, claimToken: HOLDER, ...extra })
	});

const heldJobs = async (s: Scene, query: string) => {
	const at = Date.now();
	const res = await app.request(`/machine/jobs${query}`, { headers: s.host });
	return { status: res.status, data: ((await res.json()) as any).data as any[], took: Date.now() - at };
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const kinds = (data: any[]) => data.map((j) => j.kind);

async function liveRun(label: string, appId: number) {
	const s = await scene(label, appId);
	const { body } = await requestSession(s);
	const id = body.data.id as string;
	await app.request('/machine/heartbeat', {
		method: 'POST',
		headers: s.host,
		body: JSON.stringify({ capabilities: ['launches'] })
	});
	expect((await report(s, id, 'starting')).status).toBe(200);
	expect((await report(s, id, 'live')).status).toBe(200);
	const second = await newGame(appId + 1000);
	await Library.upsert({
		id: Identifier.ascending('userLibrary'),
		userId: s.owner.userId,
		gameId: second,
		playtime2w: null,
		playtimeForever: null,
		lastPlayed: null
	});
	return { s, id, second };
}

describe('GET /machine/jobs?wait=', () => {
	test('with no work, it is held for the wait and then answers empty', async () => {
		const s = await scene('wait-empty', 8100);
		const r = await heldJobs(s, '?wait=1');
		expect(r.status).toBe(200);
		expect(r.data).toEqual([]);
		expect(r.took).toBeGreaterThanOrEqual(900);
		expect(r.took).toBeLessThan(3000);
		expect(JobWake.held(s.machineId)).toBe(0);
	});

	test('without wait, or with one that is not a number, it answers at once', async () => {
		const s = await scene('wait-absent', 8101);
		expect((await heldJobs(s, '')).took).toBeLessThan(500);
		const r = await heldJobs(s, '?wait=soon');
		expect(r.status).toBe(200);
		expect(r.took).toBeLessThan(500);
		expect((await heldJobs(s, '?wait=0')).took).toBeLessThan(500);
	});

	test('with work waiting, it answers at once', async () => {
		const s = await scene('wait-ready', 8102);
		await requestSession(s);
		const r = await heldJobs(s, '?wait=20');
		expect(kinds(r.data)).toEqual(['session.start']);
		expect(r.took).toBeLessThan(1000);
	});

	test('a run requested while held is handed over at once', async () => {
		const s = await scene('wait-start', 8103);
		const held = heldJobs(s, '?wait=20');
		await sleep(300);
		expect(JobWake.held(s.machineId)).toBe(1);
		const { body } = await requestSession(s);
		const r = await held;
		expect(r.data.map((j) => j.sessionId)).toEqual([body.data.id]);
		expect(r.took).toBeLessThan(2000);
		expect(JobWake.held(s.machineId)).toBe(0);
	});

	test('a stop asked for while held is handed over at once', async () => {
		const { s, id } = await liveRun('wait-stop', 8104);
		const held = heldJobs(s, '?wait=20');
		await sleep(300);
		const stop = await app.request(`/session/${id}/stop`, { method: 'POST', headers: s.user });
		expect(stop.status).toBe(200);
		const r = await held;
		expect(r.data).toEqual([
			{ kind: 'session.stop', sessionId: id, boxId: s.box.id, reason: 'user' }
		]);
		expect(r.took).toBeLessThan(2000);
	});

	test('a launch added, and a launch stopped, while held are each handed over at once', async () => {
		const { s, id, second } = await liveRun('wait-launch', 8105);
		const addHeld = heldJobs(s, '?wait=20');
		await sleep(300);
		const added = await app.request(`/session/${id}/launch`, {
			method: 'POST',
			headers: s.user,
			body: JSON.stringify({ gameId: second })
		});
		expect(added.status).toBe(201);
		const launch = ((await added.json()) as any).data;
		const start = await addHeld;
		expect(start.data.map((j) => [j.kind, j.launchId])).toEqual([['launch.start', launch.id]]);
		expect(start.took).toBeLessThan(2000);

		const running = await app.request(`/session/${id}/launch/${launch.id}/state`, {
			method: 'POST',
			headers: s.host,
			body: JSON.stringify({ state: 'running', claimToken: HOLDER })
		});
		expect(running.status).toBe(200);

		const stopHeld = heldJobs(s, '?wait=20');
		await sleep(300);
		const stopped = await app.request(`/session/${id}/launch/${launch.id}/stop`, {
			method: 'POST',
			headers: s.user
		});
		expect(stopped.status).toBe(200);
		const stop = await stopHeld;
		expect(stop.data.map((j) => [j.kind, j.launchId])).toEqual([['launch.stop', launch.id]]);
		expect(stop.took).toBeLessThan(2000);
	});

	test('a run that ends frees a slot, and the next in line is handed it at once', async () => {
		const { s, id } = await liveRun('wait-slot', 8106);
		await app.request('/machine/heartbeat', {
			method: 'POST',
			headers: s.host,
			body: JSON.stringify({ slots: 1 })
		});
		// The one slot is held by the live run, so a second box's run waits.
		const other = await Box.create({
			id: Identifier.ascending('box'),
			userId: s.owner.userId,
			machineId: s.machineId,
			label: 'second',
			tier: 'sm'
		});
		const queued = await Session.request({
			id: Identifier.ascending('session'),
			boxId: other.id,
			gameId: s.gameId,
			linkedAccountId: s.owner.linkedAccountId
		});
		const held = heldJobs(s, '?wait=20');
		await sleep(300);
		expect(JobWake.held(s.machineId)).toBe(1);
		expect((await report(s, id, 'ended')).status).toBe(200);
		const r = await held;
		expect(r.data.map((j) => j.sessionId)).toEqual([queued.id]);
		expect(r.took).toBeLessThan(2000);
	});

	test('a host that hangs up stops being held', async () => {
		const s = await scene('wait-abort', 8107);
		const controller = new AbortController();
		const call = Promise.resolve(
			app.request('/machine/jobs?wait=20', { headers: s.host, signal: controller.signal })
		).catch(() => null);
		await sleep(300);
		expect(JobWake.held(s.machineId)).toBe(1);
		controller.abort();
		await call;
		await sleep(200);
		expect(JobWake.held(s.machineId)).toBe(0);
	});
});
