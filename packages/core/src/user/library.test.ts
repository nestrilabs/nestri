import { afterAll, describe, expect, test } from 'bun:test';

import { Box } from '../box/index.js';
import { Fixtures } from '../db/fixtures.js';
import { GameDownload } from '../game/download.js';
import { Machine } from '../machine/index.js';
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
	if (createdGameIds.length > 0) {
		await sql`delete from "game_download" where game_id in ${sql(createdGameIds)}`;
	}
	if (createdUserIds.length > 0) {
		// box→machine is `restrict`: boxes go before the users their machines cascade from.
		await sql`delete from "box" where user_id in ${sql(createdUserIds)}`;
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

describe('Library.listByUserWithGames', () => {
	test("shows a download only from a host the person's box is on, named by its card", async () => {
		const me = await Fixtures.owner('library-mine');
		const them = await Fixtures.owner('library-theirs');
		createdUserIds.push(me.userId, them.userId);
		const game = await newGame(9_100_004);
		await own(me.userId, game);

		const mine = await Fixtures.machine(me, 'library-mine-host');
		const theirs = await Fixtures.machine(them, 'library-theirs-host');
		await Machine.setGpus({ id: mine, gpus: [{ model: 'NVIDIA GeForce RTX 3060', pciId: '10de:2504' }] });
		await Box.create({ id: Identifier.ascending('box'), userId: me.userId, machineId: mine, label: 'mine', tier: 'sm' });

		// Someone else's host has it, and is the most recent: still not shown.
		await GameDownload.upsertState({ hostId: mine, gameId: game, status: 'downloading' });
		await GameDownload.upsertState({ hostId: theirs, gameId: game, status: 'ready' });

		const [entry] = await Library.listByUserWithGames(me.userId);
		expect(entry?.download?.hostId).toBe(mine);
		expect(entry?.download?.status).toBe('downloading');
		expect(entry?.download?.gpu).toBe('NVIDIA GeForce RTX 3060');
	});

	test('with no box, no download is shown at all', async () => {
		const me = await Fixtures.owner('library-boxless');
		const them = await Fixtures.owner('library-boxless-other');
		createdUserIds.push(me.userId, them.userId);
		const game = await newGame(9_100_005);
		await own(me.userId, game);
		await GameDownload.upsertState({ hostId: await Fixtures.machine(them), gameId: game, status: 'ready' });

		const [entry] = await Library.listByUserWithGames(me.userId);
		expect(entry?.download).toBeNull();
	});
});
