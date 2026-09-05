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

describe('Box.applyHostReport', () => {
	async function placed(label: string, count: number) {
		const owner = await newOwner(label);
		const machineId = await Fixtures.machine(owner);
		const boxes = [];
		for (let i = 0; i < count; i++) {
			boxes.push(
				await Box.create({
					id: Identifier.ascending('box'),
					userId: owner.userId,
					machineId,
					label: `${label}-${i}`,
					tier: 'sm'
				})
			);
		}
		return { owner, machineId, boxes };
	}

	test('a snapshot moves the boxes it names', async () => {
		const { machineId, boxes } = await placed('report-moves', 2);

		const outcome = await Box.applyHostReport({
			machineId,
			boxes: [
				{ boxId: boxes[0]!.id, tier: 'sm', state: 'running', pid: 1234, uptimeS: 45 },
				{ boxId: boxes[1]!.id, tier: 'sm', state: 'stopped', reason: 'guest exited 0', clean: true }
			]
		});

		expect(outcome.recorded).toBe(2);
		expect(outcome.unknown).toEqual([]);
		expect(outcome.markedStopped).toEqual([]);

		expect((await Box.fromID(boxes[0]!.id))!.state).toBe('running');
		const stopped = (await Box.fromID(boxes[1]!.id))!;
		expect(stopped.state).toBe('stopped');
		expect(stopped.stopReason).toBe('guest exited 0');
		expect(stopped.stopClean).toBe(true);
	});

	test('pid and uptime are accepted and not stored', async () => {
		const { machineId, boxes } = await placed('report-drops', 1);

		await Box.applyHostReport({
			machineId,
			boxes: [{ boxId: boxes[0]!.id, tier: 'sm', state: 'running', pid: 4711, uptimeS: 900 }]
		});

		// The columns do not exist, so what this pins is that the row is still
		// readable and carries nothing invented in the two nullable columns it
		// does have.
		const row = (await Box.fromID(boxes[0]!.id))!;
		expect(row.state).toBe('running');
		expect(row.stopReason).toBeNull();
		expect(row.stopClean).toBeNull();
	});

	test('a running box the snapshot omits is stopped, and says why', async () => {
		const { machineId, boxes } = await placed('report-omits', 2);
		await Box.setState({ id: boxes[0]!.id, state: 'running' });
		await Box.setState({ id: boxes[1]!.id, state: 'running' });

		const outcome = await Box.applyHostReport({
			machineId,
			boxes: [{ boxId: boxes[0]!.id, tier: 'sm', state: 'running', uptimeS: 5 }]
		});

		expect(outcome.markedStopped).toEqual([boxes[1]!.id]);
		const gone = (await Box.fromID(boxes[1]!.id))!;
		expect(gone.state).toBe('stopped');
		expect(gone.stopReason).toBe(Box.OMITTED_FROM_REPORT);
		expect(gone.stopClean).toBe(false);
	});

	test('a created box the snapshot omits is left alone', async () => {
		// The ordinary path, not a divergence: a person creates a box here before
		// its host has been told anything about it.
		const { machineId, boxes } = await placed('report-created', 1);

		const outcome = await Box.applyHostReport({ machineId, boxes: [] });

		expect(outcome.markedStopped).toEqual([]);
		expect((await Box.fromID(boxes[0]!.id))!.state).toBe('created');
	});

	test('an empty snapshot from a host holding nothing stops only what was running', async () => {
		const { machineId, boxes } = await placed('report-empty', 2);
		await Box.setState({ id: boxes[0]!.id, state: 'running' });

		const outcome = await Box.applyHostReport({ machineId, boxes: [] });

		expect(outcome.recorded).toBe(0);
		expect(outcome.markedStopped).toEqual([boxes[0]!.id]);
		expect((await Box.fromID(boxes[1]!.id))!.state).toBe('created');
	});

	test('a box the snapshot names that is not placed here is never created', async () => {
		const { machineId } = await placed('report-unknown', 0);
		const invented = Identifier.ascending('box');

		const outcome = await Box.applyHostReport({
			machineId,
			boxes: [{ boxId: invented, tier: 'lg', state: 'running', uptimeS: 1 }]
		});

		expect(outcome.unknown).toEqual([invented]);
		expect(outcome.recorded).toBe(0);
		expect(await Box.fromID(invented)).toBeNull();
	});

	test('a snapshot cannot move a box placed on another host', async () => {
		const mine = await placed('report-mine', 1);
		const theirs = await placed('report-theirs', 1);
		await Box.setState({ id: theirs.boxes[0]!.id, state: 'running' });

		const outcome = await Box.applyHostReport({
			machineId: mine.machineId,
			boxes: [
				{
					boxId: theirs.boxes[0]!.id,
					tier: 'sm',
					state: 'stopped',
					reason: 'mine now',
					clean: false
				}
			]
		});

		expect(outcome.unknown).toEqual([theirs.boxes[0]!.id]);
		expect((await Box.fromID(theirs.boxes[0]!.id))!.state).toBe('running');
	});
});
