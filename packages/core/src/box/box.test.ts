import { afterAll, describe, expect, test } from 'bun:test';

import { Fixtures } from '../db/fixtures.js';
import { testDb } from '../db/test.js';
import { Identifier } from '../id.js';
import { Box } from './index.js';

const sql = testDb();

const createdUserIds: string[] = [];

async function newOwner(label: string) {
	const o = await Fixtures.owner(label);
	createdUserIds.push(o.userId);
	return o;
}

afterAll(async () => {
	if (createdUserIds.length > 0) {
		// Machines cascade from the user, and boxes cascade from both — but the
		// box→machine FK is `restrict`, so the box rows have to go first or the
		// machine delete is refused. Deleting boxes explicitly says that out loud.
		await sql`delete from "box" where user_id in ${sql(createdUserIds)}`;
		await sql`delete from "user" where id in ${sql(createdUserIds)}`;
		createdUserIds.length = 0;
	}
});

describe('Box', () => {
	test('a new box starts created, sm, and with nothing to explain', async () => {
		const owner = await newOwner('box-defaults');
		const machineId = await Fixtures.machine(owner);

		const box = await Box.create({
			id: Identifier.ascending('box'),
			userId: owner.userId,
			machineId,
			label: 'living room',
			tier: 'sm'
		});

		expect(box.state).toBe('created');
		expect(box.tier).toBe('sm');
		expect(box.stopReason).toBeNull();
		expect(box.stopClean).toBeNull();
		expect(box.id.startsWith('box_')).toBe(true);
	});

	test('a stop records its reason, and starting again clears it', async () => {
		const owner = await newOwner('box-stopreason');
		const machineId = await Fixtures.machine(owner);
		const box = await Box.create({
			id: Identifier.ascending('box'),
			userId: owner.userId,
			machineId,
			label: 'faulty',
			tier: 'sm'
		});

		const stopped = await Box.setState({
			id: box.id,
			state: 'stopped',
			stopReason: 'guest faulted',
			stopClean: false
		});
		expect(stopped?.state).toBe('stopped');
		expect(stopped?.stopReason).toBe('guest faulted');
		expect(stopped?.stopClean).toBe(false);

		// The point of the test: a box that recovered must not keep explaining a
		// failure it is no longer in.
		const running = await Box.setState({
			id: box.id,
			state: 'running',
			stopReason: null,
			stopClean: null
		});
		expect(running?.state).toBe('running');
		expect(running?.stopReason).toBeNull();
		expect(running?.stopClean).toBeNull();
	});

	test('renaming is scoped to the owner, so someone else’s box is a miss', async () => {
		const owner = await newOwner('box-owner');
		const stranger = await newOwner('box-stranger');
		const machineId = await Fixtures.machine(owner);
		const box = await Box.create({
			id: Identifier.ascending('box'),
			userId: owner.userId,
			machineId,
			label: 'mine',
			tier: 'sm'
		});

		expect(await Box.rename({ id: box.id, userId: stranger.userId, label: 'yours' })).toBeNull();
		expect((await Box.fromID(box.id))?.label).toBe('mine');

		const renamed = await Box.rename({ id: box.id, userId: owner.userId, label: 'ours' });
		expect(renamed?.label).toBe('ours');
	});

	test('a box cannot be placed on a machine that does not exist', async () => {
		const owner = await newOwner('box-badmachine');
		// The whole reason `machineId` is a foreign key: before 0048 a host was
		// named by an unchecked string, so this would have succeeded and produced
		// a box on a machine nobody owns.
		await expect(
			Box.create({
				id: Identifier.ascending('box'),
				userId: owner.userId,
				machineId: 'mch_doesnotexistdoesnotexist_',
				label: 'nowhere',
				tier: 'sm'
			})
		).rejects.toThrow();
	});

	test('boxes list by user and by machine', async () => {
		const owner = await newOwner('box-listing');
		const machineA = await Fixtures.machine(owner, 'host-a');
		const machineB = await Fixtures.machine(owner, 'host-b');

		for (const [machineId, label] of [
			[machineA, 'a1'],
			[machineA, 'a2'],
			[machineB, 'b1']
		] as const) {
			await Box.create({
				id: Identifier.ascending('box'),
				userId: owner.userId,
				machineId,
				label,
				tier: 'sm'
			});
		}

		expect(await Box.listByUser(owner.userId)).toHaveLength(3);
		expect((await Box.listByMachine(machineA)).map((b) => b.label)).toEqual(['a1', 'a2']);
		expect((await Box.listByMachine(machineB)).map((b) => b.label)).toEqual(['b1']);
	});
});
