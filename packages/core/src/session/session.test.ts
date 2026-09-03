import { afterAll, describe, expect, test } from 'bun:test';

import { Box } from '../box/index.js';
import { Fixtures } from '../db/fixtures.js';
import { testDb } from '../db/test.js';
import { Game } from '../game/index.js';
import { Identifier } from '../id.js';
import { Session } from './index.js';

const sql = testDb();

const createdUserIds: string[] = [];
const createdGameIds: string[] = [];

async function newOwner(label: string) {
	const o = await Fixtures.owner(label);
	createdUserIds.push(o.userId);
	return o;
}

async function newGame(steamAppId: number): Promise<string> {
	const [row] = await Game.upsert({
		id: Identifier.ascending('game'),
		steamAppId,
		slug: `session-test-${steamAppId}`,
		name: `Session Test ${steamAppId}`
	});
	if (!row) throw new Error('expected a game row');
	createdGameIds.push(row.id);
	return row.id;
}

/** A user, a team, a machine, a box and a game — everything a session needs. */
async function scene(label: string, steamAppId: number) {
	const owner = await newOwner(label);
	const machineId = await Fixtures.machine(owner);
	const box = await Box.create({
		id: Identifier.ascending('box'),
		userId: owner.userId,
		machineId,
		label,
		tier: 'sm'
	});
	return { owner, box, gameId: await newGame(steamAppId) };
}

afterAll(async () => {
	if (createdUserIds.length > 0) {
		// session cascades from box; box has to precede the machine, which
		// cascades from the user.
		await sql`delete from "box" where user_id in ${sql(createdUserIds)}`;
		await sql`delete from "user" where id in ${sql(createdUserIds)}`;
		createdUserIds.length = 0;
	}
	if (createdGameIds.length > 0) {
		await sql`delete from "game" where id in ${sql(createdGameIds)}`;
		createdGameIds.length = 0;
	}
});

describe('Session', () => {
	test('a session starts requested, with no ticket and no times', async () => {
		const { owner, box, gameId } = await scene('ses-defaults', 5400);

		const session = await Session.create({
			id: Identifier.ascending('session'),
			boxId: box.id,
			gameId,
			linkedAccountId: owner.linkedAccountId
		});

		expect(session.state).toBe('requested');
		expect(session.ticket).toBeNull();
		expect(session.timeStarted).toBeNull();
		expect(session.timeStopped).toBeNull();
	});

	test('the ticket is a stream: a later one replaces the first', async () => {
		const { owner, box, gameId } = await scene('ses-ticket', 5401);
		const session = await Session.create({
			id: Identifier.ascending('session'),
			boxId: box.id,
			gameId,
			linkedAccountId: owner.linkedAccountId
		});

		expect((await Session.setTicket({ id: session.id, ticket: 'ticket-one' }))?.ticket).toBe(
			'ticket-one'
		);
		// The vsock contract calls the ticket "a stream, not one value" — a second
		// ticket is a better address for the same session, not a new session.
		expect((await Session.setTicket({ id: session.id, ticket: 'ticket-two' }))?.ticket).toBe(
			'ticket-two'
		);
		expect(await Session.listByBox(box.id)).toHaveLength(1);
	});

	test('going live stamps a start time, and a repeat report does not move it', async () => {
		const { owner, box, gameId } = await scene('ses-live', 5402);
		const session = await Session.create({
			id: Identifier.ascending('session'),
			boxId: box.id,
			gameId,
			linkedAccountId: owner.linkedAccountId
		});

		const live = await Session.setState({ id: session.id, state: 'live', errorMessage: null });
		expect(live?.state).toBe('live');
		expect(live?.timeStarted).not.toBeNull();

		// This is the billing property: a duplicate `live` must not extend a
		// session somebody is charged for.
		const again = await Session.setState({ id: session.id, state: 'live', errorMessage: null });
		expect(again?.timeStarted).toBe(live!.timeStarted);
	});

	test('ending stamps a stop time once, and failing records why', async () => {
		const { owner, box, gameId } = await scene('ses-end', 5403);
		const session = await Session.create({
			id: Identifier.ascending('session'),
			boxId: box.id,
			gameId,
			linkedAccountId: owner.linkedAccountId
		});
		await Session.setState({ id: session.id, state: 'live', errorMessage: null });

		const failed = await Session.setState({
			id: session.id,
			state: 'failed',
			errorMessage: 'steam guard timed out'
		});
		expect(failed?.state).toBe('failed');
		expect(failed?.errorMessage).toBe('steam guard timed out');
		expect(failed?.timeStopped).not.toBeNull();

		const ended = await Session.setState({ id: session.id, state: 'ended', errorMessage: null });
		expect(ended?.timeStopped).toBe(failed!.timeStopped);
		// A state that is not `failed` carries no explanation.
		expect(ended?.errorMessage).toBeNull();
	});

	test('the active session is the one that has not stopped', async () => {
		const { owner, box, gameId } = await scene('ses-active', 5404);
		const first = await Session.create({
			id: Identifier.ascending('session'),
			boxId: box.id,
			gameId,
			linkedAccountId: owner.linkedAccountId
		});
		await Session.setState({ id: first.id, state: 'ended', errorMessage: null });

		expect(await Session.activeForBox(box.id)).toBeNull();

		const second = await Session.create({
			id: Identifier.ascending('session'),
			boxId: box.id,
			gameId,
			linkedAccountId: owner.linkedAccountId
		});
		expect((await Session.activeForBox(box.id))?.id).toBe(second.id);
	});

	test('deleting a box takes its sessions with it', async () => {
		const { owner, box, gameId } = await scene('ses-cascade', 5405);
		await Session.create({
			id: Identifier.ascending('session'),
			boxId: box.id,
			gameId,
			linkedAccountId: owner.linkedAccountId
		});

		await sql`delete from "box" where id = ${box.id}`;
		expect(await Session.listByBox(box.id)).toHaveLength(0);
	});
});
