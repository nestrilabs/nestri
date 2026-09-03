import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import { Fixtures } from '../db/fixtures.js';
import { testDb } from '../db/test.js';
import { Game } from '../game/index.js';
import { Identifier } from '../id.js';
import { GameDownload } from './download.js';

const sql = testDb();

/**
 * Real registered hosts, not `hst_…` strings.
 *
 * These were literals until 0048 made `host_id` a foreign key. The old values
 * were the bug the key exists to prevent — a download row attributed to a host
 * that had never registered — so the test that used them was asserting against
 * a state the database now refuses.
 */
let HOST_A: string;
let HOST_B: string;

const createdGameIds: string[] = [];
const createdUserIds: string[] = [];
const gameIdByApp = new Map<number, string>();

async function ensureGame(steamAppId: number): Promise<string> {
	const existing = gameIdByApp.get(steamAppId);
	if (existing) return existing;
	const [row] = await Game.upsert({
		id: Identifier.ascending('game'),
		steamAppId,
		slug: `test-game-${steamAppId}`,
		name: `Test Game ${steamAppId}`
	});
	if (!row) throw new Error('expected a game row');
	createdGameIds.push(row.id);
	gameIdByApp.set(steamAppId, row.id);
	return row.id;
}

beforeAll(async () => {
	const owner = await Fixtures.owner('download-host-owner');
	createdUserIds.push(owner.userId);
	HOST_A = await Fixtures.machine(owner, 'download-host-a');
	HOST_B = await Fixtures.machine(owner, 'download-host-b');

	await ensureGame(4400);
	await ensureGame(4401);
	await ensureGame(4402);
});

afterAll(async () => {
	if (createdGameIds.length > 0) {
		// Deleting the games cascades to their game_download rows.
		await sql`delete from "game" where id in ${sql(createdGameIds)}`;
		createdGameIds.length = 0;
	}
	if (createdUserIds.length > 0) {
		// And the user cascades to the machines those rows pointed at.
		await sql`delete from "user" where id in ${sql(createdUserIds)}`;
		createdUserIds.length = 0;
	}
});

describe('GameDownload', () => {
	function expectRow<T>(row: T | null | undefined): T {
		expect(row).not.toBeNull();
		return row as T;
	}

	test('a new host/game creates one row', async () => {
		const gameId = await ensureGame(4400);
		const row = expectRow(
			await GameDownload.upsertState({
				hostId: HOST_A,
				gameId,
				status: 'downloading',
				progressBytes: 1000,
				totalBytes: 5000
			})
		);

		expect(row.id).toMatch(/^gdl_/);
		expect(row.hostId).toBe(HOST_A);
		expect(row.gameId).toBe(gameId);
		expect(row.status).toBe('downloading');
		expect(row.timeStarted).toBeInstanceOf(Date);
	});

	test('repeating the same host/game updates one row', async () => {
		const gameId = await ensureGame(4400);
		const first = expectRow(
			await GameDownload.upsertState({
				hostId: HOST_A,
				gameId,
				status: 'downloading',
				progressBytes: 1000,
				totalBytes: 5000
			})
		);
		const second = expectRow(
			await GameDownload.upsertState({
				hostId: HOST_A,
				gameId,
				status: 'downloading',
				progressBytes: 2000,
				totalBytes: 5000
			})
		);

		expect(second.id).toBe(first.id);
		expect(second.progressBytes).toBe(2000);
		expect(second.totalBytes).toBe(5000);

		const count =
			await sql`select count(*)::int as n from "game_download" where host_id = ${HOST_A} and game_id = ${gameId}`;
		expect(count[0]?.n).toBe(1);
	});

	test('reports for other users do not create another row', async () => {
		const gameId = await ensureGame(4401);
		// No user dimension exists on the shared state row: reports for any
		// user land on the single (host, game) row.
		await GameDownload.upsertState({
			hostId: HOST_A,
			gameId,
			status: 'downloading',
			progressBytes: 1
		});
		await GameDownload.upsertState({
			hostId: HOST_A,
			gameId,
			status: 'downloading',
			progressBytes: 2
		});
		const rows = await GameDownload.listByHost(HOST_A);
		expect(rows.filter((r) => r.gameId === gameId).length).toBe(1);
	});

	test('two hosts create two independent rows', async () => {
		const gameId = await ensureGame(4401);
		const a = expectRow(
			await GameDownload.upsertState({
				hostId: HOST_A,
				gameId,
				status: 'downloading'
			})
		);
		const b = expectRow(
			await GameDownload.upsertState({
				hostId: HOST_B,
				gameId,
				status: 'downloading'
			})
		);

		expect(a.id).not.toBe(b.id);
		expect(a.hostId).toBe(HOST_A);
		expect(b.hostId).toBe(HOST_B);
	});

	test('verifying is accepted', async () => {
		const gameId = await ensureGame(4401);
		const row = expectRow(
			await GameDownload.upsertState({
				hostId: HOST_A,
				gameId,
				status: 'verifying',
				progressBytes: 2048
			})
		);
		expect(row.status).toBe('verifying');
		expect(row.timeStarted).toBeInstanceOf(Date);
	});

	test('ready sets timeCompleted', async () => {
		const gameId = await ensureGame(4400);
		const row = expectRow(
			await GameDownload.upsertState({
				hostId: HOST_A,
				gameId,
				status: 'ready',
				progressBytes: 5000,
				totalBytes: 5000
			})
		);
		expect(row.status).toBe('ready');
		expect(row.timeCompleted).toBeInstanceOf(Date);
		expect(row.timeStarted).toBeInstanceOf(Date);
	});

	test('failed records an error', async () => {
		const gameId = await ensureGame(4401);
		const row = expectRow(
			await GameDownload.upsertState({
				hostId: HOST_A,
				gameId,
				status: 'failed',
				errorMessage: 'depot key missing'
			})
		);
		expect(row.status).toBe('failed');
		expect(row.errorMessage).toBe('depot key missing');
	});

	test('progress updates do not require a user ID', async () => {
		const gameId = await ensureGame(4402);
		const row = expectRow(
			await GameDownload.upsertState({
				hostId: HOST_B,
				gameId,
				status: 'downloading',
				progressBytes: 12345
			})
		);
		expect(row.progressBytes).toBe(12345);
		expect(row).not.toHaveProperty('userId');
	});

	test('old user_download table is no longer referenced', async () => {
		const rows =
			await sql`select table_name from information_schema.tables where table_schema = 'public' and table_name = 'user_download'`;
		expect(rows.length).toBe(0);
	});

	test('findByHostAndGame and listByGame', async () => {
		const gameId = await ensureGame(4402);
		const found = await GameDownload.findByHostAndGame({ hostId: HOST_B, gameId });
		expect(found).not.toBeNull();
		expect(found!.gameId).toBe(gameId);

		const byGame = await GameDownload.listByGame(gameId);
		expect(byGame.some((r) => r.hostId === HOST_B)).toBe(true);
	});

	test('markReady and markFailed update the row', async () => {
		const gameId = await ensureGame(4402);
		const ready = await GameDownload.markReady({ hostId: HOST_B, gameId });
		expect(ready!.status).toBe('ready');
		expect(ready!.timeCompleted).toBeInstanceOf(Date);

		const failed = await GameDownload.markFailed({
			hostId: HOST_B,
			gameId,
			errorMessage: 'disk full'
		});
		expect(failed!.status).toBe('failed');
		expect(failed!.errorMessage).toBe('disk full');
	});
});
