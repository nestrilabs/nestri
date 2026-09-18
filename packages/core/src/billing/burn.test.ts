import { afterAll, describe, expect, test } from 'bun:test';

import { Box } from '../box/index.js';
import { Fixtures } from '../db/fixtures.js';
import { testDb } from '../db/test.js';
import { Game } from '../game/index.js';
import { Identifier } from '../id.js';
import { Machine } from '../machine/index.js';
import { Session } from '../session/index.js';
import { Burn } from './burn.js';
import { Window } from './window.js';

const sql = testDb();

const createdUserIds: string[] = [];
const createdGameIds: string[] = [];

async function scene(label: string, steamAppId: number) {
	const owner = await Fixtures.owner(label);
	createdUserIds.push(owner.userId);
	const machine = await Machine.register({
		id: Identifier.ascending('machine'),
		ownerUserId: owner.userId,
		teamId: owner.teamId,
		label
	});
	const gameId = Identifier.ascending('game');
	await Game.upsert({ id: gameId, steamAppId, slug: `${label}-${steamAppId}`, name: label });
	createdGameIds.push(gameId);

	async function newRun() {
		const box = await Box.create({
			id: Identifier.ascending('box'),
			userId: owner.userId,
			machineId: machine.id,
			label,
			tier: 'sm'
		});
		return Session.request({
			id: Identifier.ascending('session'),
			boxId: box.id,
			gameId,
			linkedAccountId: owner.linkedAccountId
		});
	}

	return { owner, teamId: owner.teamId, newRun };
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
		createdUserIds.length = 0;
	}
	if (createdGameIds.length > 0) {
		await sql`delete from "game" where id in ${sql(createdGameIds)}`;
		createdGameIds.length = 0;
	}
});

const MINUTE = 60;

function at(secondsFromStart: number, base: Date) {
	return new Date(base.getTime() + secondsFromStart * 1000);
}

describe('Segments', () => {
	test('a run accrues one unit a second while it is the only one', async () => {
		const s = await scene('burn-solo', 7100);
		const run = await s.newRun();
		const t0 = new Date();

		await Burn.start({ teamId: s.teamId, sessionId: run.id, at: t0 });
		const banked = await Burn.stop({
			teamId: s.teamId,
			sessionId: run.id,
			at: at(10 * MINUTE, t0)
		});

		expect(banked).toBe(10 * MINUTE);
		const counters = await Burn.counters(s.teamId);
		expect(Number(counters?.fiveHourUsage)).toBe(10 * MINUTE);
		expect(Number(counters?.sevenDayUsage)).toBe(10 * MINUTE);
		expect(Number(counters?.thirtyDayUsage)).toBe(10 * MINUTE);
	});

	test('two at once cost two a second between them, not four', async () => {
		// The factor is on the total. Two deadline guarantees cost twice one,
		// and reading it per-session would have made this four.
		const s = await scene('burn-pair', 7101);
		const first = await s.newRun();
		const second = await s.newRun();
		const t0 = new Date();

		await Burn.start({ teamId: s.teamId, sessionId: first.id, at: t0 });
		await Burn.start({ teamId: s.teamId, sessionId: second.id, at: t0 });
		await Burn.stop({ teamId: s.teamId, sessionId: first.id, at: at(MINUTE, t0) });
		await Burn.stop({ teamId: s.teamId, sessionId: second.id, at: at(MINUTE, t0) });

		const counters = await Burn.counters(s.teamId);
		expect(Number(counters?.fiveHourUsage)).toBe(2 * MINUTE);
	});

	test('a run only pays the higher rate for the time the sibling was there', async () => {
		// The reason segments exist. A rate that applied from the moment the
		// second run started must not be backdated over the first run's solo
		// time, and must not linger after the sibling has gone.
		const s = await scene('burn-overlap', 7102);
		const long = await s.newRun();
		const brief = await s.newRun();
		const t0 = new Date();

		await Burn.start({ teamId: s.teamId, sessionId: long.id, at: t0 });
		// One minute alone.
		await Burn.start({ teamId: s.teamId, sessionId: brief.id, at: at(MINUTE, t0) });
		// One minute together, which costs two.
		await Burn.stop({ teamId: s.teamId, sessionId: brief.id, at: at(2 * MINUTE, t0) });
		// One minute alone again.
		await Burn.stop({ teamId: s.teamId, sessionId: long.id, at: at(3 * MINUTE, t0) });

		// 60 solo + 120 shared + 60 solo.
		const counters = await Burn.counters(s.teamId);
		expect(Number(counters?.fiveHourUsage)).toBe(4 * MINUTE);
	});

	test('stopping twice does not bill twice', async () => {
		const s = await scene('burn-idempotent', 7103);
		const run = await s.newRun();
		const t0 = new Date();

		await Burn.start({ teamId: s.teamId, sessionId: run.id, at: t0 });
		await Burn.stop({ teamId: s.teamId, sessionId: run.id, at: at(MINUTE, t0) });
		const second = await Burn.stop({
			teamId: s.teamId,
			sessionId: run.id,
			at: at(2 * MINUTE, t0)
		});

		expect(second).toBe(0);
		expect(Number((await Burn.counters(s.teamId))?.fiveHourUsage)).toBe(MINUTE);
	});

	test('resegmenting mid-run banks what has been spent without stopping it', async () => {
		// A long run has to land incrementally: burn that only arrives when a
		// session ends is burn that cannot refuse the next one.
		const s = await scene('burn-tick', 7104);
		const run = await s.newRun();
		const t0 = new Date();

		await Burn.start({ teamId: s.teamId, sessionId: run.id, at: t0 });
		await Burn.resegment({ teamId: s.teamId, at: at(5 * MINUTE, t0) });

		expect(Number((await Burn.counters(s.teamId))?.fiveHourUsage)).toBe(5 * MINUTE);
		expect((await Burn.openSegments(s.teamId)).length).toBe(1);

		await Burn.stop({ teamId: s.teamId, sessionId: run.id, at: at(6 * MINUTE, t0) });
		expect(Number((await Burn.counters(s.teamId))?.fiveHourUsage)).toBe(6 * MINUTE);
	});
});

describe('The counters', () => {
	test('the first tick and the thousandth are the same call', async () => {
		// There is no row until something burns, and a read-then-insert would
		// race two first ticks into two rows the unique index then refuses —
		// turning an ordinary heartbeat into an error.
		const s = await scene('burn-first', 7105);
		expect(await Burn.counters(s.teamId)).toBeNull();

		await Burn.record({ teamId: s.teamId, amount: 30 });
		await Burn.record({ teamId: s.teamId, amount: 12 });
		expect(Number((await Burn.counters(s.teamId))?.fiveHourUsage)).toBe(42);
	});

	test('a total whose window has rolled past starts again rather than adding', async () => {
		// The staleness rule on the write side. Asserted through the stored
		// stamp, because this is the behaviour that replaces a reset job.
		const s = await scene('burn-stale', 7106);
		await Burn.record({ teamId: s.teamId, amount: 100 });

		// Age the five-hour stamp past its window, leaving the others fresh.
		await sql`
			update "burn_counter"
			set five_hour_at = now() - make_interval(secs => ${Window.FIVE_HOURS + 60})
			where team_id = ${s.teamId}
		`;
		await Burn.record({ teamId: s.teamId, amount: 7 });

		const counters = await Burn.counters(s.teamId);
		// Started again from the new amount alone.
		expect(Number(counters?.fiveHourUsage)).toBe(7);
		// The windows that had not rolled kept accumulating.
		expect(Number(counters?.sevenDayUsage)).toBe(107);
		expect(Number(counters?.thirtyDayUsage)).toBe(107);
	});

	test('recording nothing writes nothing', async () => {
		const s = await scene('burn-zero', 7107);
		await Burn.record({ teamId: s.teamId, amount: 0 });
		expect(await Burn.counters(s.teamId)).toBeNull();
	});
});

describe('Rates', () => {
	test('a run costs the same whoever is running it', () => {
		// The plan buys an allowance, never a discount on the meter. If the
		// rate moved with the tier, an upgrade would change what past runs cost
		// and the bars would stop being comparable.
		expect(Burn.rateMilliFor(1)).toBe(Burn.SCALE);
		expect(Burn.rateMilliFor(4)).toBe(Burn.SCALE);
	});

	test('nothing running costs nothing', () => {
		expect(Burn.rateMilliFor(0)).toBe(0);
	});

	test('burn is whole seconds, never a fraction of one', () => {
		expect(Burn.amountFor(90, 1500)).toBe(135);
		expect(Burn.amountFor(1, 1)).toBe(0);
		expect(Burn.amountFor(-5, Burn.SCALE)).toBe(0);
	});
});
