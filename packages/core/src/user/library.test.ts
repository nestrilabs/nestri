import { afterAll, describe, expect, test } from 'bun:test';

import { Fixtures } from '../db/fixtures.js';
import { testDb } from '../db/test.js';
import { Game } from '../game/index.js';
import { Identifier } from '../id.js';
import { Library } from './library.js';

const sql = testDb();

const createdUserIds: string[] = [];
const createdGameIds: string[] = [];

async function newGame(steamAppId: number): Promise<string> {
	const [row] = await Game.upsert({
		id: Identifier.ascending('game'),
		steamAppId,
		slug: `library-test-${steamAppId}`,
		name: `Library Test ${steamAppId}`
	});
	if (!row) throw new Error('expected a game row');
	createdGameIds.push(row.id);
	return row.id;
}

async function own(userId: string, gameId: string) {
	await Library.upsert({ id: Identifier.ascending('userLibrary'), userId, gameId });
}

afterAll(async () => {
	if (createdUserIds.length > 0) {
		await sql`delete from "user_library" where user_id in ${sql(createdUserIds)}`;
		await sql`delete from "user" where id in ${sql(createdUserIds)}`;
	}
	if (createdGameIds.length > 0) {
		await sql`delete from "game" where id in ${sql(createdGameIds)}`;
	}
});

describe('Library.prune', () => {
	test('drops what the account no longer owns, and brings it back when owned again', async () => {
		const owner = await Fixtures.owner('library-prune');
		createdUserIds.push(owner.userId);
		const kept = await newGame(9_100_001);
		const lost = await newGame(9_100_002);
		await own(owner.userId, kept);
		await own(owner.userId, lost);

		expect(await Library.prune({ userId: owner.userId, keep: [kept] })).toBe(1);
		const after = (await Library.listByUser(owner.userId)).map((e) => e.gameId);
		expect(after).toEqual([kept]);

		await own(owner.userId, lost);
		expect((await Library.listByUser(owner.userId)).length).toBe(2);
	});

	test('an empty sync removes nothing', async () => {
		const owner = await Fixtures.owner('library-empty');
		createdUserIds.push(owner.userId);
		await own(owner.userId, await newGame(9_100_003));

		expect(await Library.prune({ userId: owner.userId, keep: [] })).toBe(0);
		expect((await Library.listByUser(owner.userId)).length).toBe(1);
	});
});
