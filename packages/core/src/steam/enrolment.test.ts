import { afterAll, describe, expect, test } from 'bun:test';

import { Fixtures } from '../db/fixtures.js';
import { testDb } from '../db/test.js';
import { Enrolment } from './enrolment.js';

const sql = testDb();

const createdUserIds: string[] = [];

function steamId(n: number) {
	return `765611980001${String(n).padStart(5, '0')}`;
}

async function host(label: string) {
	const owner = await Fixtures.owner(label);
	createdUserIds.push(owner.userId);
	return { machineId: await Fixtures.machine(owner, label), userId: owner.userId };
}

afterAll(async () => {
	if (createdUserIds.length > 0) {
		await sql`delete from "user" where id in ${sql(createdUserIds)}`;
		createdUserIds.length = 0;
	}
});

describe('the schema holds no token, and cannot be made to', () => {
	test('the columns are exactly the facts about an enrolment', async () => {
		// The refresh token lives on the host, encrypted, and nowhere else. A
		// nullable column that could hold one is an invitation, so the guard is
		// the column list itself rather than a promise in a comment: adding
		// `refresh_token`, or an `encrypted_token`, or a `secret`, fails here.
		const columns = await sql<{ column_name: string }[]>`
			select column_name from information_schema.columns
			where table_schema = 'public' and table_name = 'steam_enrolment'
			order by column_name
		`;
		expect(columns.map((c) => c.column_name)).toEqual([
			'enrolled_at',
			'last_ok_at',
			'machine_id',
			'revoked_at',
			'state',
			'steam_id',
			'user_id'
		]);
	});

	test('the Steam id is not unique across machines', async () => {
		// One Steam account on two hosts is two rows and two tokens. A unique
		// index here would look like hygiene and would refuse the second host.
		const indexes = await sql<{ indexdef: string }[]>`
			select indexdef from pg_indexes
			where schemaname = 'public' and tablename = 'steam_enrolment'
		`;
		const uniqueOnSteamId = indexes.filter(
			(i) => i.indexdef.includes('UNIQUE') && i.indexdef.includes('steam_id')
		);
		expect(uniqueOnSteamId).toEqual([]);
	});

	test('an enrolment is one fact per machine and user', async () => {
		const primary = await sql<{ indexdef: string }[]>`
			select indexdef from pg_indexes
			where schemaname = 'public'
			  and tablename = 'steam_enrolment'
			  and indexname = 'steam_enrolment_machine_id_user_id_pk'
		`;
		expect(primary).toHaveLength(1);
	});
});

describe('Enrolment.record', () => {
	test('a first report creates the row as enrolled', async () => {
		const h = await host('core-enrol-new');
		const row = await Enrolment.record({ ...h, steamId: steamId(1) });
		expect(row).toMatchObject({ ...h, steamId: steamId(1), state: 'enrolled' });
		expect(row.lastOkAt).toBeNull();
		expect(row.revokedAt).toBeNull();
		expect(() => new Date(row.enrolledAt).toISOString()).not.toThrow();
	});

	test('a second report is an upsert, not a duplicate', async () => {
		const h = await host('core-enrol-upsert');
		const first = await Enrolment.record({ ...h, steamId: steamId(2) });
		const second = await Enrolment.record({ ...h, steamId: steamId(3) });

		expect(second.enrolledAt).toBe(first.enrolledAt);
		expect(second.steamId).toBe(steamId(3));
		expect(await Enrolment.listByMachine(h.machineId)).toHaveLength(1);
	});

	test('re-enrolling clears the refusal', async () => {
		const h = await host('core-enrol-recover');
		await Enrolment.record({ ...h, steamId: steamId(4) });
		await Enrolment.markStale(h);
		const back = await Enrolment.record({ ...h, steamId: steamId(4) });
		expect(back.state).toBe('enrolled');
	});
});

describe('Enrolment.markStale', () => {
	test('a refused token is recorded against that host alone', async () => {
		const mine = await host('core-stale-mine');
		const theirs = await host('core-stale-theirs');
		await Enrolment.record({ ...mine, steamId: steamId(5) });
		await Enrolment.record({ ...theirs, steamId: steamId(5) });

		const marked = await Enrolment.markStale(mine);
		expect(marked?.state).toBe('stale');

		const untouched = await Enrolment.listByMachine(theirs.machineId);
		expect(untouched[0]!.state).toBe('enrolled');
	});

	test('nothing to mark is null rather than a write', async () => {
		const h = await host('core-stale-absent');
		expect(await Enrolment.markStale(h)).toBeNull();
		expect(await Enrolment.listByMachine(h.machineId)).toEqual([]);
	});
});

describe('Enrolment.listByMachine', () => {
	test('every enrolment for one host, oldest first', async () => {
		const h = await host('core-list');
		const second = await Fixtures.owner('core-list-second');
		createdUserIds.push(second.userId);

		await Enrolment.record({ ...h, steamId: steamId(6) });
		await Enrolment.record({
			machineId: h.machineId,
			userId: second.userId,
			steamId: steamId(7)
		});

		const rows = await Enrolment.listByMachine(h.machineId);
		expect(rows).toHaveLength(2);
		expect(rows.map((r) => r.userId)).toEqual([h.userId, second.userId]);
	});

	test('an unknown host has no enrolments rather than an error', async () => {
		expect(await Enrolment.listByMachine('mch_nosuchmachine')).toEqual([]);
	});
});
