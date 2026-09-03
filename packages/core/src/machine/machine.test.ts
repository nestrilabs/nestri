import { afterAll, describe, expect, test } from 'bun:test';

import { Fixtures } from '../db/fixtures.js';
import { testDb } from '../db/test.js';
import { Identifier } from '../id.js';
import { Machine } from './index.js';

const sql = testDb();

const createdUserIds: string[] = [];

async function newOwner(label: string) {
	const o = await Fixtures.owner(label);
	createdUserIds.push(o.userId);
	return o;
}

afterAll(async () => {
	if (createdUserIds.length > 0) {
		await sql`delete from "user" where id in ${sql(createdUserIds)}`;
		createdUserIds.length = 0;
	}
});

describe('Machine registration', () => {
	test('registration returns a secret once and stores only its digest', async () => {
		const owner = await newOwner('mch-secret');
		const registered = await Machine.register({
			id: Identifier.ascending('machine'),
			ownerUserId: owner.userId,
			teamId: owner.teamId,
			label: 'first-box'
		});

		expect(registered.secret.startsWith('msk_')).toBe(true);

		// The digest is what is stored, so the secret itself must not be findable.
		const rows = await sql`select secret_hash from machine where id = ${registered.id}`;
		expect(rows[0]!.secret_hash).not.toBe(registered.secret);
		expect(rows[0]!.secret_hash).toHaveLength(64);

		// And it never leaves `authenticate`, even in memory.
		const authed = await Machine.authenticate({ id: registered.id, secret: registered.secret });
		expect(authed?.id).toBe(registered.id);
		expect(JSON.stringify(authed)).not.toContain(rows[0]!.secret_hash);
	});

	test('a wrong secret and a wrong id are refused the same way', async () => {
		const owner = await newOwner('mch-wrong');
		const registered = await Machine.register({
			id: Identifier.ascending('machine'),
			ownerUserId: owner.userId,
			teamId: owner.teamId,
			label: 'box'
		});

		expect(await Machine.authenticate({ id: registered.id, secret: 'msk_wrong' })).toBeNull();
		expect(
			await Machine.authenticate({ id: 'mch_nosuchmachinenosuchmach_', secret: registered.secret })
		).toBeNull();
	});

	test('a host always has a team, so registering without one is impossible', async () => {
		const owner = await newOwner('mch-team');
		// `teamId` is notNull since 0048 and required by the schema, so this is a
		// validation failure rather than a row with a null team.
		//
		// `toThrow` and not `rejects.toThrow`: `fn()` parses its input
		// synchronously, before any promise exists, so a bad argument never
		// becomes a rejected promise.
		expect(() =>
			Machine.register({
				id: Identifier.ascending('machine'),
				ownerUserId: owner.userId,
				// @ts-expect-error — the point of the test is that this is refused
				teamId: null,
				label: 'teamless'
			})
		).toThrow();
	});
});

describe('Machine heartbeat', () => {
	test('a beat records a time and it moves forward', async () => {
		const owner = await newOwner('mch-beat');
		const machineId = await Fixtures.machine(owner);

		expect((await Machine.fromID(machineId))?.lastSeen).toBeNull();

		const first = await Machine.touchLastSeen(machineId);
		expect(first).not.toBeNull();

		const second = await Machine.touchLastSeen(machineId);
		expect(second!.getTime()).toBeGreaterThanOrEqual(first!.getTime());
	});

	test('beating for a machine that is gone reports nothing rather than pretending', async () => {
		// A host deleted mid-beat must be told to re-register, so this returns
		// null and the route turns that into a 404.
		expect(await Machine.touchLastSeen('mch_deletedmiddeletedmid___')).toBeNull();
	});

	test('online is derived from the last beat, not stored', async () => {
		expect(Machine.isOnline(null)).toBe(false);
		expect(Machine.isOnline(new Date())).toBe(true);

		// One missed beat is a lost packet; three is a dead host. Placement must
		// not flap on the first.
		const oneMissed = new Date(Date.now() - Machine.HEARTBEAT_SECONDS * 1000 - 1000);
		expect(Machine.isOnline(oneMissed)).toBe(true);

		const wellPast = new Date(
			Date.now() - Machine.HEARTBEAT_SECONDS * (Machine.OFFLINE_AFTER_MISSED + 1) * 1000
		);
		expect(Machine.isOnline(wellPast)).toBe(false);
	});
});
