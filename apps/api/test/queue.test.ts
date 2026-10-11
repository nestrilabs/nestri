import { afterAll, describe, expect, test } from 'bun:test';

import { AccessToken } from '@nestri/core/access-token/index';
import { Box } from '@nestri/core/box/index';
import { Fixtures } from '@nestri/core/db/fixtures';
import { testDb } from '@nestri/core/db/test';
import { Game } from '@nestri/core/game/index';
import { Identifier } from '@nestri/core/id';
import { Machine } from '@nestri/core/machine/index';
import { Session } from '@nestri/core/session/index';

import { app } from '../app/index';

const sql = testDb();
const createdUserIds: string[] = [];
const createdGameIds: string[] = [];

afterAll(async () => {
	await sql`delete from session where box_id in (select id from box where user_id = any(${createdUserIds}))`;
	await sql`delete from box where user_id = any(${createdUserIds})`;
	await sql`delete from machine where owner_user_id = any(${createdUserIds})`;
	await sql`delete from game where id = any(${createdGameIds})`;
	await sql`delete from "user" where id = any(${createdUserIds})`;
});

/** One host, and a way to put a player in line on it. */
async function host(label: string, steamAppId: number) {
	const operator = await Fixtures.owner(`${label}-host`);
	createdUserIds.push(operator.userId);
	const machine = await Machine.register({
		id: Identifier.ascending('machine'),
		ownerUserId: operator.userId,
		teamId: operator.teamId,
		label
	});
	const [game] = await Game.upsert({
		id: Identifier.ascending('game'),
		steamAppId,
		slug: `queue-${steamAppId}`,
		name: `Queue ${steamAppId}`
	});
	createdGameIds.push(game!.id);
	const headers = {
		'x-nestri-machine-id': machine.id,
		'x-nestri-machine-secret': machine.secret,
		'content-type': 'application/json'
	};

	async function player(name: string, paid: boolean) {
		const owner = await Fixtures.owner(`${label}-${name}`);
		createdUserIds.push(owner.userId);
		const box = await Box.create({
			id: Identifier.ascending('box'),
			userId: owner.userId,
			machineId: machine.id,
			label: name,
			tier: 'sm'
		});
		const run = await Session.request({
			id: Identifier.ascending('session'),
			boxId: box.id,
			gameId: game!.id,
			linkedAccountId: owner.linkedAccountId,
			trial: !paid
		});
		const pat = await AccessToken.create({
			id: Identifier.ascending('accessToken'),
			ownerUserId: owner.userId,
			teamId: null,
			name
		});
		const read = async () => {
			const res = await app.request(`/session/${run.id}`, {
				headers: { authorization: `Bearer ${pat.token}` }
			});
			return ((await res.json()) as any).data;
		};
		return { run, read };
	}

	const beat = (slots: number) =>
		app.request('/machine/heartbeat', {
			method: 'POST',
			headers,
			body: JSON.stringify({ slots })
		});
	const jobs = async () => {
		const res = await app.request('/machine/jobs', { headers });
		return (((await res.json()) as any).data as any[]).filter((j) => j.kind === 'session.start');
	};
	return { machine, player, beat, jobs };
}

describe('the line for a full host', () => {
	test('a host is handed only as many runs as it has free slots', async () => {
		const h = await host('queue-slots', 7701);
		const a = await h.player('a', true);
		const b = await h.player('b', true);
		const c = await h.player('c', true);

		// An agent that never said how many it holds gets everything, as before.
		expect(await h.jobs()).toHaveLength(3);

		expect((await h.beat(2)).status).toBe(200);
		expect((await h.jobs()).map((j) => j.sessionId)).toEqual([a.run.id, b.run.id]);

		await Session.setState({ id: a.run.id, state: 'live' });
		expect((await h.jobs()).map((j) => j.sessionId)).toEqual([b.run.id]);
		await Session.setState({ id: b.run.id, state: 'live' });
		expect(await h.jobs()).toHaveLength(0);
		expect((await c.read()).queue).toEqual({ position: 1, paidFirst: false });

		// A slot frees and the next in line is handed it.
		await Session.setState({ id: a.run.id, state: 'ended' });
		expect((await h.jobs()).map((j) => j.sessionId)).toEqual([c.run.id]);
	});

	test('paid runs go first, and a free player is told so', async () => {
		const h = await host('queue-paid', 7702);
		await h.beat(1);
		const playing = await h.player('playing', true);
		await Session.setState({ id: playing.run.id, state: 'live' });

		const free = await h.player('free', false);
		const paid = await h.player('paid', true);

		expect(await free.read()).toMatchObject({ queue: { position: 2, paidFirst: true } });
		expect(await paid.read()).toMatchObject({ queue: { position: 1, paidFirst: false } });

		await Session.setState({ id: playing.run.id, state: 'ended' });
		expect((await h.jobs()).map((j) => j.sessionId)).toEqual([paid.run.id]);
	});

	test('a run nobody asks after leaves the line', async () => {
		const h = await host('queue-gone', 7703);
		await h.beat(1);
		const playing = await h.player('playing', true);
		await Session.setState({ id: playing.run.id, state: 'live' });
		const gone = await h.player('gone', true);
		const here = await h.player('here', true);

		await sql`update session set time_created = now() - interval '6 minutes' where id = ${gone.run.id}`;
		await sql`update session set time_created = now() - interval '5 minutes' where id = ${here.run.id}`;
		expect((await here.read()).queue.position).toBe(2);

		await Session.setState({ id: playing.run.id, state: 'ended' });
		expect((await h.jobs()).map((j) => j.sessionId)).toEqual([here.run.id]);
		const left = await Session.fromID(gone.run.id);
		expect(left).toMatchObject({ state: 'ended', errorMessage: 'Left the queue' });
	});

	test('a run with a slot is not in line', async () => {
		const h = await host('queue-none', 7704);
		const a = await h.player('a', true);
		await Session.setState({ id: a.run.id, state: 'live' });
		expect((await a.read()).queue).toBeNull();
	});
});
