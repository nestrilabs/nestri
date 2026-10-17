import { afterAll, describe, expect, test } from 'bun:test';

import { AccessToken } from '@nestri/core/access-token/index';
import { Box } from '@nestri/core/box/index';
import { Fixtures } from '@nestri/core/db/fixtures';
import { testDb } from '@nestri/core/db/test';
import { Game } from '@nestri/core/game/index';
import { Identifier } from '@nestri/core/id';
import { Machine } from '@nestri/core/machine/index';
import { Session } from '@nestri/core/session/index';
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

const reportLaunch = (s: Scene, id: string, launchId: string, state: string, extra: object = {}) =>
	app.request(`/session/${id}/launch/${launchId}/state`, {
		method: 'POST',
		headers: s.host,
		body: JSON.stringify({ state, claimToken: HOLDER, ...extra })
	});

const addLaunch = (s: Scene, id: string, gameId: string) =>
	app.request(`/session/${id}/launch`, {
		method: 'POST',
		headers: s.user,
		body: JSON.stringify({ gameId })
	});

const stopLaunch = (s: Scene, id: string, launchId: string) =>
	app.request(`/session/${id}/launch/${launchId}/stop`, { method: 'POST', headers: s.user });

const jobs = async (s: Scene) =>
	((await (await app.request('/machine/jobs', { headers: s.host })).json()) as any).data as any[];

const read = async (s: Scene, id: string) =>
	((await (await app.request(`/session/${id}`, { headers: s.user })).json()) as any).data;

/** A live run, with a second game stocked in the owner's library. */
const says = (s: Scene, capabilities: string[]) =>
	app.request('/machine/heartbeat', {
		method: 'POST',
		headers: s.host,
		body: JSON.stringify({ capabilities })
	});

async function liveRun(label: string, appId: number, opts: { capable?: boolean } = {}) {
	const s = await scene(label, appId);
	const { body } = await requestSession(s);
	const id = body.data.id as string;
	const first = body.data.launches[0].id as string;
	if (opts.capable !== false) await says(s, ['launches']);
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
	return { s, id, first, second };
}

describe('launches', () => {
	test('a run is created with its first launch, running once the box is live', async () => {
		const { s, id, first } = await liveRun('launch-first', 7100);
		const run = await read(s, id);
		expect(run.launches).toHaveLength(1);
		expect(run.launches[0]).toMatchObject({ id: first, gameId: s.gameId, state: 'running' });
		// The first launch starts with the box; it is never a job of its own.
		expect((await jobs(s)).filter((j) => j.kind === 'launch.start')).toEqual([]);
	});

	test('a second game in a live box is a launch.start job, until the host reports it', async () => {
		const { s, id, second } = await liveRun('launch-add', 7101);
		const res = await addLaunch(s, id, second);
		expect(res.status).toBe(201);
		const launch = ((await res.json()) as any).data;
		expect(launch.id.startsWith('lch_')).toBe(true);
		expect(launch.state).toBe('requested');

		const handed = (await jobs(s)).filter((j) => j.kind === 'launch.start');
		expect(handed).toEqual([
			{
				kind: 'launch.start',
				sessionId: id,
				launchId: launch.id,
				boxId: s.box.id,
				gameId: second,
				steamAppId: 8101,
				linkedAccountId: s.owner.linkedAccountId,
				userId: s.owner.userId
			}
		]);

		expect((await reportLaunch(s, id, launch.id, 'running')).status).toBe(200);
		expect((await reportLaunch(s, id, launch.id, 'running')).status).toBe(200);
		expect((await jobs(s)).filter((j) => j.kind === 'launch.start')).toEqual([]);
		const run = await read(s, id);
		expect(run.launches.map((l: any) => l.state)).toEqual(['running', 'running']);
	});

	test('a run that is not running takes no launch', async () => {
		const s = await scene('launch-notrunning', 7102);
		const { body } = await requestSession(s);
		// Still waiting for a host.
		expect((await addLaunch(s, body.data.id, s.gameId)).status).toBe(409);
		await report(s, body.data.id, 'starting');
		await report(s, body.data.id, 'live');
		await app.request(`/session/${body.data.id}/stop`, { method: 'POST', headers: s.user });
		// Being stopped.
		expect((await addLaunch(s, body.data.id, s.gameId)).status).toBe(409);
	});

	test('a launch needs a game in your library and a run that is yours', async () => {
		const { s, id } = await liveRun('launch-checks', 7103);
		const other = await scene('launch-checks-other', 7104);
		const notOwned = await newGame(7105);
		expect((await addLaunch(s, id, notOwned)).status).toBe(403);
		expect((await addLaunch(s, id, Identifier.ascending('game'))).status).toBe(404);
		expect((await addLaunch(other, id, other.gameId)).status).toBe(404);
	});

	test('closing one window ends that launch, not the run', async () => {
		const { s, id, first, second } = await liveRun('launch-close-one', 7106);
		const added = ((await (await addLaunch(s, id, second)).json()) as any).data;
		await reportLaunch(s, id, added.id, 'running');

		const res = await stopLaunch(s, id, first);
		expect(res.status).toBe(200);
		expect(((await res.json()) as any).data.timeStopRequested).not.toBeNull();
		const work = await jobs(s);
		expect(work.filter((j) => j.kind === 'launch.stop')).toEqual([
			{ kind: 'launch.stop', sessionId: id, launchId: first, boxId: s.box.id }
		]);
		expect(work.filter((j) => j.kind === 'session.stop')).toEqual([]);

		expect((await reportLaunch(s, id, first, 'ended', { endReason: 'user' })).status).toBe(200);
		const run = await read(s, id);
		expect(run.state).toBe('live');
		expect(run.timeStopRequested).toBeNull();
		expect(run.launches.map((l: any) => l.state)).toEqual(['ended', 'running']);
	});

	test('the last launch over stops the run, as its owner stopping it would', async () => {
		const { s, id, first } = await liveRun('launch-last', 7107);
		expect((await reportLaunch(s, id, first, 'ended', { endReason: 'game_exited' })).status).toBe(
			200
		);
		const run = await read(s, id);
		expect(run.timeStopRequested).not.toBeNull();
		expect((await jobs(s)).filter((j) => j.kind === 'session.stop')).toEqual([
			{ kind: 'session.stop', sessionId: id, boxId: s.box.id, reason: 'user' }
		]);
		// The host stops the box as it would any run.
		expect((await report(s, id, 'ended', { endReason: 'user' })).status).toBe(200);
		expect((await read(s, id)).state).toBe('ended');
	});

	test('a run ending ends every launch in it', async () => {
		const { s, id, second } = await liveRun('launch-cascade', 7108);
		const added = ((await (await addLaunch(s, id, second)).json()) as any).data;
		expect((await report(s, id, 'ended', { endReason: 'host_stopped' })).status).toBe(200);
		const run = await read(s, id);
		expect(run.launches.map((l: any) => l.state)).toEqual(['ended', 'ended']);
		expect(run.launches[1].id).toBe(added.id);
		expect((await jobs(s)).filter((j) => j.kind.startsWith('launch.'))).toEqual([]);
	});

	test('stopping the only launch of a run nobody has picked up ends the run at once', async () => {
		const s = await scene('launch-unclaimed', 7109);
		const { body } = await requestSession(s);
		const res = await stopLaunch(s, body.data.id, body.data.launches[0].id);
		expect(((await res.json()) as any).data.state).toBe('ended');
		const run = await read(s, body.data.id);
		expect(run.state).toBe('ended');
		expect(run.endReason).toBe('user');
	});

	test('launch reports are held to the run’s claim and its host', async () => {
		const { s, id, first } = await liveRun('launch-holder', 7110);
		const other = await scene('launch-holder-other', 7111);
		const wrong = await app.request(`/session/${id}/launch/${first}/state`, {
			method: 'POST',
			headers: s.host,
			body: JSON.stringify({ state: 'ended', claimToken: 'x'.repeat(32) })
		});
		expect(wrong.status).toBe(409);
		expect((await reportLaunch(other, id, first, 'ended')).status).toBe(403);
		expect((await reportLaunch(s, id, 'lch_' + '0'.repeat(26), 'ended')).status).toBe(403);
		expect((await reportLaunch(s, id, first, 'running', { endReason: 'user' })).status).toBe(400);
		// A person cannot report for the host.
		const asUser = await app.request(`/session/${id}/launch/${first}/state`, {
			method: 'POST',
			headers: s.user,
			body: JSON.stringify({ state: 'ended', claimToken: HOLDER })
		});
		expect(asUser.status).toBe(403);
		await reportLaunch(s, id, first, 'failed', { errorMessage: 'crashed' });
		expect((await reportLaunch(s, id, first, 'running')).status).toBe(409);
	});
});

describe('launches racing the last one ending', () => {
	test('a launch added as the last one ends is either kept or refused, never orphaned', async () => {
		for (let i = 0; i < 5; i++) {
			const { s, id, first, second } = await liveRun(`launch-race-${i}`, 7200 + i);
			const [ended, added] = await Promise.all([
				reportLaunch(s, id, first, 'ended', { endReason: 'game_exited' }),
				addLaunch(s, id, second)
			]);
			expect(ended.status).toBe(200);
			const run = await read(s, id);
			if (added.status === 201) {
				// Added first: the run keeps going with the new launch.
				expect(run.timeStopRequested).toBeNull();
				expect(run.launches.map((l: any) => l.state)).toEqual(['ended', 'requested']);
			} else {
				// Stopped first: the launch was refused, and none was written.
				expect(added.status).toBe(409);
				expect(run.timeStopRequested).not.toBeNull();
				expect(run.launches).toHaveLength(1);
			}
		}
	});
});

describe('a host that does not handle launches', () => {
	test('is handed no launch work, and adding or closing one is refused', async () => {
		const { s, id, first, second } = await liveRun('launch-old-host', 7300, { capable: false });
		const added = await addLaunch(s, id, second);
		expect(added.status).toBe(409);
		expect(((await added.json()) as any).code).toBe('host_too_old');
		const closed = await stopLaunch(s, id, first);
		expect(closed.status).toBe(409);
		expect(((await closed.json()) as any).code).toBe('host_too_old');
		// Stopping the run works as it always has.
		const stopped = await app.request(`/session/${id}/stop`, { method: 'POST', headers: s.user });
		expect(stopped.status).toBe(200);
		expect((await jobs(s)).map((j) => j.kind)).toEqual(['session.stop']);
	});

	test('a heartbeat without capabilities leaves the stored list alone', async () => {
		const { s, id, second } = await liveRun('launch-cap-keep', 7301);
		const beat = await app.request('/machine/heartbeat', {
			method: 'POST',
			headers: s.host,
			body: JSON.stringify({ slots: 4 })
		});
		expect(beat.status).toBe(200);
		expect((await addLaunch(s, id, second)).status).toBe(201);
	});

	test('a host that stops listing launches is handed none', async () => {
		const { s, id, second } = await liveRun('launch-cap-drop', 7302);
		expect((await addLaunch(s, id, second)).status).toBe(201);
		await says(s, []);
		expect((await jobs(s)).filter((j) => j.kind.startsWith('launch.'))).toEqual([]);
	});
});
