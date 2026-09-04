import { afterAll, describe, expect, test } from 'bun:test';

import { Fixtures } from '../db/fixtures.js';
import { testDb } from '../db/test.js';
import { Identifier } from '../id.js';
import { Placement } from './placement.js';
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
		await sql`delete from "box" where user_id in ${sql(createdUserIds)}`;
		await sql`delete from "user" where id in ${sql(createdUserIds)}`;
		createdUserIds.length = 0;
	}
});

describe('Placement', () => {
	test('a box is placed when it is created, and the caller names no host', async () => {
		const owner = await newOwner('place-one');
		const machineId = await Fixtures.machine(owner, 'place-one-host');

		// No `machineId` in the input: choosing the host is the placer's job,
		// and the whole point of the interface is that the caller cannot do it.
		const box = await Box.createPlaced({
			id: Identifier.ascending('box'),
			userId: owner.userId,
			label: 'living room',
			tier: 'sm'
		});

		expect(box.machineId).toBe(machineId);
	});

	test('nowhere to put it is an answer, not a crash', async () => {
		const owner = await newOwner('place-none');

		// `box.machineId` is notNull, so a placer with no candidate must refuse
		// rather than hand back something the insert would reject.
		await expect(
			Placement.choose({ userId: owner.userId, tier: 'sm' })
		).rejects.toThrow();
	});

	test('more than one candidate is refused rather than picked silently', async () => {
		const owner = await newOwner('place-two');
		await Fixtures.machine(owner, 'place-two-a');
		await Fixtures.machine(owner, 'place-two-b');

		// There is no policy for choosing between hosts yet. Inventing one here
		// is how a placement decision ends up buried in the caller: the refusal
		// is what keeps the choice in one replaceable place.
		await expect(
			Placement.choose({ userId: owner.userId, tier: 'sm' })
		).rejects.toThrow();
	});

	test('the placer is swappable without touching box creation', async () => {
		const owner = await newOwner('place-swap');
		const machineId = await Fixtures.machine(owner, 'place-swap-host');

		const asked: unknown[] = [];
		const box = await Box.createPlaced(
			{
				id: Identifier.ascending('box'),
				userId: owner.userId,
				label: 'bedroom',
				tier: 'lg'
			},
			async (input) => {
				asked.push(input);
				return machineId;
			}
		);

		expect(box.machineId).toBe(machineId);
		// The placer is told who the box is for and what size was asked for,
		// which is the whole input a real scheduler needs.
		expect(asked).toEqual([{ userId: owner.userId, tier: 'lg' }]);
	});
});
