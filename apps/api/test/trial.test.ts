import { afterAll, afterEach, describe, expect, test } from 'bun:test';

import { AccessToken } from '@nestri/core/access-token/index';
import { Fixtures } from '@nestri/core/db/fixtures';
import { testDb } from '@nestri/core/db/test';
import { Env } from '@nestri/core/env';
import { Game } from '@nestri/core/game/index';
import { Identifier } from '@nestri/core/id';
import { Trial } from '@nestri/core/trial/index';
import { Library } from '@nestri/core/user/library';

import { app } from '../app/index';
import { TEST_FRONTEND_URL } from './setup';

const sql = testDb();
const createdUserIds: string[] = [];
const createdOrgIds: string[] = [];
const createdGameIds: string[] = [];

/** Times on the clock the trial keeps, written out as instants. */
const WEDNESDAY = new Date('2026-10-07T12:00:00Z');
const SATURDAY = new Date('2026-10-10T12:00:00Z');

function at(instant: Date) {
	Trial.useClock(() => instant);
}

afterEach(() => Trial.useClock(() => new Date()));

afterAll(async () => {
	await sql`delete from trial_claim where user_id = any(${createdUserIds}) or email like '%@trial.example.test'`;
	await sql`delete from burn_segment where session_id in (select s.id from session s join box b on b.id = s.box_id where b.user_id = any(${createdUserIds}))`;
	await sql`delete from session where box_id in (select id from box where user_id = any(${createdUserIds}))`;
	await sql`delete from box where user_id = any(${createdUserIds})`;
	await sql`delete from machine where owner_user_id = any(${createdUserIds})`;
	await sql`delete from organisation where id = any(${createdOrgIds})`;
	await sql`delete from game where id = any(${createdGameIds})`;
	await sql`delete from "user" where id = any(${createdUserIds})`;
});

/** A fleet of one, a person with a box on it and a game to play, and both credentials. */
async function scene(label: string) {
	const operator = await Fixtures.owner(`${label}-op`);
	createdUserIds.push(operator.userId);
	const fleet = await Fixtures.fleet(operator, 1);
	createdOrgIds.push(fleet.organisationId);
	Env.init({
		NODE_ENV: 'test',
		FRONTEND_URL: TEST_FRONTEND_URL,
		FLEET_ORGANISATION_ID: fleet.organisationId
	});

	const owner = await Fixtures.owner(label);
	createdUserIds.push(owner.userId);
	const pat = await AccessToken.create({
		id: Identifier.ascending('accessToken'),
		ownerUserId: owner.userId,
		teamId: null,
		name: label
	});
	const user = { authorization: `Bearer ${pat.token}`, 'content-type': 'application/json' };

	const boxRes = await app.request('/box', {
		method: 'POST',
		headers: user,
		body: JSON.stringify({ on: 'fleet' })
	});
	const box = ((await boxRes.json()) as any).data;

	const steamAppId = 980000 + createdGameIds.length;
	const [game] = await Game.upsert({
		id: Identifier.ascending('game'),
		steamAppId,
		slug: `trial-${steamAppId}`,
		name: `Trial ${steamAppId}`
	});
	createdGameIds.push(game!.id);
	await Library.upsert({
		id: Identifier.ascending('userLibrary'),
		userId: owner.userId,
		gameId: game!.id,
		playtime2w: null,
		playtimeForever: null,
		lastPlayed: null
	});

	const machine = fleet.machines[0]!;
	return {
		owner,
		box,
		gameId: game!.id,
		user,
		host: {
			'x-nestri-machine-id': machine.id,
			'x-nestri-machine-secret': machine.secret
		}
	};
}

async function play(s: Awaited<ReturnType<typeof scene>>) {
	const res = await app.request('/session', {
		method: 'POST',
		headers: s.user,
		body: JSON.stringify({
			boxId: s.box.id,
			gameId: s.gameId,
			linkedAccountId: s.owner.linkedAccountId
		})
	});
	return { res, body: (await res.json()) as any };
}

/** A past run of this box, live from `start` for `minutes`, as the trial counts it. */
async function playedBefore(
	boxId: string,
	gameId: string,
	linkedAccountId: string,
	start: Date,
	minutes: number
) {
	const id = Identifier.ascending('session');
	const stop = new Date(start.getTime() + minutes * 60_000);
	await sql`insert into session (id, box_id, game_id, linked_account_id, state, trial, time_started, time_stopped)
		values (${id}, ${boxId}, ${gameId}, ${linkedAccountId}, 'ended', true, ${start}, ${stop})`;
	return id;
}

describe('The weekend window', () => {
	test('Friday 00:00 to Monday 00:00 on the trial’s clock', () => {
		const closed = Trial.window(WEDNESDAY);
		expect(closed.open).toBe(false);
		// Summer time: midnight there is 21:00 UTC the day before.
		expect(closed.start.toISOString()).toBe('2026-10-08T21:00:00.000Z');
		expect(closed.end.toISOString()).toBe('2026-10-11T21:00:00.000Z');

		const open = Trial.window(SATURDAY);
		expect(open.open).toBe(true);
		expect(open.start.toISOString()).toBe(closed.start.toISOString());
	});

	test('a weekend with a clock change in it is still three calendar days', () => {
		// Summer time ends in the early hours of Sunday 25 October 2026.
		const w = Trial.window(new Date('2026-10-24T12:00:00Z'));
		expect(w.start.toISOString()).toBe('2026-10-22T21:00:00.000Z');
		expect(w.end.toISOString()).toBe('2026-10-25T22:00:00.000Z');
	});

	test('the last minute of Sunday is in; Monday 00:00 is out', () => {
		expect(Trial.window(new Date('2026-10-11T20:59:00Z')).open).toBe(true);
		expect(Trial.window(new Date('2026-10-11T21:00:00Z')).open).toBe(false);
	});
});

describe('POST /session on rented GPUs without a plan', () => {
	test('in the window: a trial run, and the claim is made', async () => {
		at(SATURDAY);
		const s = await scene('trial-ok');
		const { res, body } = await play(s);
		expect(res.status).toBe(201);
		expect(body.data.trial).toBe(true);
		expect(body.billing).toBeNull();
		const claims =
			await sql`select email, steam_id from trial_claim where team_id = ${s.owner.teamId}`;
		expect(claims.length).toBe(1);
	});

	test('outside the window: 429, naming when it opens', async () => {
		at(WEDNESDAY);
		const s = await scene('trial-closed');
		const { res, body } = await play(s);
		expect(res.status).toBe(429);
		expect(body.message).toContain('Friday to Sunday');
	});

	test('two hours used this weekend: 429', async () => {
		at(SATURDAY);
		const s = await scene('trial-spent');
		await playedBefore(
			s.box.id,
			s.gameId,
			s.owner.linkedAccountId,
			new Date('2026-10-09T10:00:00Z'),
			120
		);
		const { res, body } = await play(s);
		expect(res.status).toBe(429);
		expect(body.message).toContain('2 free hours');
	});

	test('time from last weekend does not count', async () => {
		at(SATURDAY);
		const s = await scene('trial-last-week');
		await playedBefore(
			s.box.id,
			s.gameId,
			s.owner.linkedAccountId,
			new Date('2026-10-03T10:00:00Z'),
			180
		);
		expect((await play(s)).res.status).toBe(201);
	});

	test('an address that already had the trial: 403', async () => {
		at(SATURDAY);
		const s = await scene('trial-email');
		const [person] = await sql`select email from "user" where id = ${s.owner.userId}`;
		await sql`insert into trial_claim (id, email, steam_id)
			values (${Identifier.ascending('trialClaim')}, ${person!.email}, ${'old-' + s.owner.userId})`;
		const { res, body } = await play(s);
		expect(res.status).toBe(403);
		expect(body.message).toContain('already had the free weekend');
	});

	test('a Steam account that already had the trial: 403', async () => {
		at(SATURDAY);
		const s = await scene('trial-steam');
		const [linked] =
			await sql`select provider_account_id from linked_account where id = ${s.owner.linkedAccountId}`;
		await sql`insert into trial_claim (id, email, steam_id)
			values (${Identifier.ascending('trialClaim')}, ${'gone@trial.example.test'}, ${linked!.provider_account_id})`;
		expect((await play(s)).res.status).toBe(403);
	});

	test('five paying teams close it for everyone', async () => {
		at(SATURDAY);
		const s = await scene('trial-full');
		const payers: string[] = [];
		for (let i = 0; i < Trial.PAID_SEATS; i++) {
			const p = await Fixtures.owner(`payer-${i}`);
			createdUserIds.push(p.userId);
			payers.push(p.teamId);
		}
		await sql`update team set plan = 'paid' where id = any(${payers})`;
		try {
			const { res, body } = await play(s);
			expect(res.status).toBe(403);
			expect(body.message).toContain('has closed');
		} finally {
			await sql`update team set plan = 'free' where id = any(${payers})`;
		}
	});

	test('a team with a plan is not on the trial', async () => {
		at(WEDNESDAY);
		const s = await scene('trial-paid');
		await sql`update team set plan = 'paid' where id = ${s.owner.teamId}`;
		try {
			const { res, body } = await play(s);
			expect(res.status).toBe(201);
			expect(body.data.trial).toBe(false);
			expect(body.billing).not.toBeNull();
		} finally {
			await sql`update team set plan = 'free' where id = ${s.owner.teamId}`;
		}
	});
});

describe('Stopping a trial run', () => {
	async function liveTrialRun(s: Awaited<ReturnType<typeof scene>>, startedAt: Date) {
		const id = Identifier.ascending('session');
		await sql`insert into session (id, box_id, game_id, linked_account_id, state, trial, time_started)
			values (${id}, ${s.box.id}, ${s.gameId}, ${s.owner.linkedAccountId}, 'live', true, ${startedAt})`;
		return id;
	}

	async function jobs(s: Awaited<ReturnType<typeof scene>>) {
		const res = await app.request('/machine/jobs', { headers: s.host });
		return ((await res.json()) as any).data as any[];
	}

	test('nothing to stop while the hours last', async () => {
		at(SATURDAY);
		const s = await scene('stop-none');
		await liveTrialRun(s, new Date(SATURDAY.getTime() - 60 * 60_000));
		expect((await jobs(s)).filter((j) => j.kind === 'session.stop')).toEqual([]);
	});

	test('past two hours: the host is told to stop it, for hours', async () => {
		at(SATURDAY);
		const s = await scene('stop-hours');
		const id = await liveTrialRun(s, new Date(SATURDAY.getTime() - 121 * 60_000));
		const stops = (await jobs(s)).filter((j) => j.kind === 'session.stop');
		expect(stops).toEqual([
			{ kind: 'session.stop', sessionId: id, boxId: s.box.id, reason: 'hours' }
		]);
	});

	test('when the window closes: stopped, for the window', async () => {
		at(new Date('2026-10-11T21:05:00Z'));
		const s = await scene('stop-window');
		const id = await liveTrialRun(s, new Date('2026-10-11T20:30:00Z'));
		const stops = (await jobs(s)).filter((j) => j.kind === 'session.stop');
		expect(stops).toEqual([
			{ kind: 'session.stop', sessionId: id, boxId: s.box.id, reason: 'window' }
		]);
	});
});
