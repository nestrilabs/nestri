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
	return { owner, machineId, box, gameId: await newGame(steamAppId) };
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

/** A scene with the run already requested. */
async function requestedRun(label: string, steamAppId: number) {
	const s = await scene(label, steamAppId);
	const session = await Session.request({
		id: Identifier.ascending('session'),
		boxId: s.box.id,
		gameId: s.gameId,
		linkedAccountId: s.owner.linkedAccountId
	});
	return { ...s, session };
}

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
		// A ticket is republished as addresses are discovered — a second one is a
		// better address for the same session, not a new session.
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

describe('Session jobs', () => {
	test('a requested session is the job, and it carries its kind', async () => {
		const { owner, machineId, box, gameId } = await scene('ses-job-kind', 5410);
		const session = await Session.create({
			id: Identifier.ascending('session'),
			boxId: box.id,
			gameId,
			linkedAccountId: owner.linkedAccountId
		});

		const jobs = await Session.listJobsForMachine(machineId);
		expect(jobs).toHaveLength(1);
		// The kind is on the wire from the first day there is only one, so the
		// second kind is an addition rather than a redesign.
		expect(jobs[0]!.kind).toBe('session.start');
		expect(jobs[0]!.sessionId).toBe(session.id);
		expect(jobs[0]!.boxId).toBe(box.id);
		expect(jobs[0]!.boxTier).toBe('sm');
		expect(jobs[0]!.gameId).toBe(gameId);
		expect(jobs[0]!.steamAppId).toBe(5410);
		expect(jobs[0]!.linkedAccountId).toBe(owner.linkedAccountId);
	});

	test('a job belongs to the machine its box is placed on and to no other', async () => {
		const mine = await scene('ses-job-mine', 5411);
		const theirs = await scene('ses-job-theirs', 5412);

		const session = await Session.create({
			id: Identifier.ascending('session'),
			boxId: theirs.box.id,
			gameId: theirs.gameId,
			linkedAccountId: theirs.owner.linkedAccountId
		});

		// The scope is the join, not a filter the caller asks for. A machine
		// credential is a long-lived secret on hardware in somebody's home, so
		// what one leaking can reach is decided here.
		expect(await Session.listJobsForMachine(mine.machineId)).toHaveLength(0);
		expect((await Session.listJobsForMachine(theirs.machineId)).map((j) => j.sessionId)).toEqual([
			session.id
		]);
	});

	test('only a requested session is work; a claimed one is not offered again', async () => {
		const { owner, machineId, box, gameId } = await scene('ses-job-claimed', 5413);
		const session = await Session.create({
			id: Identifier.ascending('session'),
			boxId: box.id,
			gameId,
			linkedAccountId: owner.linkedAccountId
		});

		expect(await Session.listJobsForMachine(machineId)).toHaveLength(1);
		await Session.transition({
			id: session.id,
			machineId,
			state: 'starting',
			errorMessage: null
		});
		expect(await Session.listJobsForMachine(machineId)).toHaveLength(0);
	});
});

describe('Session claim', () => {
	async function requested(label: string, steamAppId: number) {
		const s = await scene(label, steamAppId);
		const session = await Session.create({
			id: Identifier.ascending('session'),
			boxId: s.box.id,
			gameId: s.gameId,
			linkedAccountId: s.owner.linkedAccountId
		});
		return { ...s, session };
	}

	test('the claim is a compare-and-set, so the second attempt finds nothing to move', async () => {
		const { machineId, session } = await requested('ses-cas', 5420);

		const won = await Session.compareAndSetState({
			id: session.id,
			machineId,
			from: 'requested',
			to: 'starting',
			errorMessage: null
		});
		expect(won?.state).toBe('starting');

		// The same attempt again. The row is no longer `requested`, so the
		// update matches nothing — which is what stops two agents from both
		// starting the same box. Updating on the id alone would succeed twice.
		const lost = await Session.compareAndSetState({
			id: session.id,
			machineId,
			from: 'requested',
			to: 'starting',
			errorMessage: null
		});
		expect(lost).toBeNull();
		expect((await Session.fromID(session.id))?.state).toBe('starting');
	});

	test('a machine that is not the box’s host cannot move the row', async () => {
		const { session } = await requested('ses-cas-mine', 5421);
		const other = await scene('ses-cas-other', 5422);

		const result = await Session.transition({
			id: session.id,
			machineId: other.machineId,
			state: 'starting',
			errorMessage: null
		});
		expect(result.outcome).toBe('forbidden');
		expect((await Session.fromID(session.id))?.state).toBe('requested');

		// And the compare-and-set is scoped in the same query, not only by the
		// classification above it.
		expect(
			await Session.compareAndSetState({
				id: session.id,
				machineId: other.machineId,
				from: 'requested',
				to: 'starting',
				errorMessage: null
			})
		).toBeNull();
	});

	test('a session that does not exist is refused the same way as one that is not yours', async () => {
		const other = await scene('ses-cas-ghost', 5423);
		const result = await Session.transition({
			// A well-formed id for a row that was never written.
			id: Identifier.ascending('session'),
			machineId: other.machineId,
			state: 'starting',
			errorMessage: null
		});
		// Same answer as somebody else's session: an agent must not be able to
		// learn which ids exist by reporting states at them.
		expect(result.outcome).toBe('forbidden');
	});

	test('re-reporting the state you already reported changes nothing', async () => {
		const { machineId, session } = await requested('ses-repeat', 5424);

		await Session.transition({ id: session.id, machineId, state: 'starting', errorMessage: null });
		const again = await Session.transition({
			id: session.id,
			machineId,
			state: 'starting',
			errorMessage: null
		});
		// A retry after a lost response is not a broken agent.
		expect(again.outcome).toBe('unchanged');
		expect(again.session?.state).toBe('starting');
	});

	test('a transition off the table is refused and the row does not move', async () => {
		const { machineId, session } = await requested('ses-illegal', 5425);

		// Skipping `starting` means nothing ever holds the claim, and the claim
		// is the only mutual exclusion here — so it is refused however tempting
		// the shortcut looks.
		const skipped = await Session.transition({
			id: session.id,
			machineId,
			state: 'live',
			errorMessage: null
		});
		expect(skipped.outcome).toBe('illegal');
		expect((await Session.fromID(session.id))?.state).toBe('requested');

		await Session.transition({ id: session.id, machineId, state: 'starting', errorMessage: null });
		await Session.transition({ id: session.id, machineId, state: 'failed', errorMessage: 'no' });

		// Terminal is terminal: a dead session cannot be resurrected.
		const raised = await Session.transition({
			id: session.id,
			machineId,
			state: 'live',
			errorMessage: null
		});
		expect(raised.outcome).toBe('illegal');
		expect((await Session.fromID(session.id))?.state).toBe('failed');
	});

	test('the timestamps survive a duplicate report, which is what billing rests on', async () => {
		const { machineId, session } = await requested('ses-idempotent', 5426);
		await Session.transition({ id: session.id, machineId, state: 'starting', errorMessage: null });
		const live = await Session.transition({
			id: session.id,
			machineId,
			state: 'live',
			errorMessage: null
		});
		expect(live.session?.timeStarted).not.toBeNull();

		const repeat = await Session.transition({
			id: session.id,
			machineId,
			state: 'live',
			errorMessage: null
		});
		expect(repeat.session?.timeStarted).toBe(live.session!.timeStarted);
	});

	test('publishing a ticket is scoped to the host too', async () => {
		const { machineId, session } = await requested('ses-ticket-scope', 5427);
		const other = await scene('ses-ticket-other', 5428);

		await Session.transition({ id: session.id, machineId, state: 'starting', errorMessage: null });

		const refused = await Session.publishTicket({
			id: session.id,
			machineId: other.machineId,
			ticket: 'stolen'
		});
		expect(refused.outcome).toBe('forbidden');
		expect((await Session.fromID(session.id))?.ticket).toBeNull();

		// A ticket may appear while the state is still `starting`.
		const first = await Session.publishTicket({ id: session.id, machineId, ticket: 'one' });
		expect(first.outcome).toBe('published');
		expect(first.session?.ticket).toBe('one');
		expect(first.session?.state).toBe('starting');

		const second = await Session.publishTicket({ id: session.id, machineId, ticket: 'two' });
		expect(second.session?.ticket).toBe('two');
	});

	test('a stopped session has no address to publish', async () => {
		const { machineId, session } = await requested('ses-ticket-dead', 5429);
		await Session.transition({ id: session.id, machineId, state: 'starting', errorMessage: null });
		await Session.transition({ id: session.id, machineId, state: 'live', errorMessage: null });
		await Session.transition({ id: session.id, machineId, state: 'ended', errorMessage: null });

		const result = await Session.publishTicket({ id: session.id, machineId, ticket: 'late' });
		expect(result.outcome).toBe('closed');
		expect((await Session.fromID(session.id))?.ticket).toBeNull();
	});
});

describe('Session one active run per box', () => {
	test('the database refuses a second unstopped run, not just the caller', async () => {
		const { owner, machineId, box, gameId } = await scene('ses-one-active', 5450);
		const mk = () =>
			Session.request({
				id: Identifier.ascending('session'),
				boxId: box.id,
				gameId,
				linkedAccountId: owner.linkedAccountId
			});

		const first = await mk();
		expect(first.state).toBe('requested');

		// The interleaving `POST /session` permits: both callers read
		// `activeForBox` and see nothing, then both insert. The read is a
		// message; the unique index is the invariant, so the second insert is
		// refused rather than producing a row.
		const before = await Session.activeForBox(box.id);
		expect(before?.id).toBe(first.id);
		await expect(mk()).rejects.toThrow(Session.BOX_BUSY);

		expect(await Session.listByBox(box.id)).toHaveLength(1);
		// The point of all of it: the host is handed one launch, not two.
		expect(await Session.listJobsForMachine(machineId)).toHaveLength(1);
	});

	test('a box that has stopped running is free to run again', async () => {
		const { owner, machineId, box, gameId } = await scene('ses-one-active-reuse', 5451);
		const mk = () =>
			Session.request({
				id: Identifier.ascending('session'),
				boxId: box.id,
				gameId,
				linkedAccountId: owner.linkedAccountId
			});

		const first = await mk();
		await Session.transition({ id: first.id, machineId, state: 'starting', errorMessage: null });
		await Session.transition({ id: first.id, machineId, state: 'live', errorMessage: null });
		await Session.transition({ id: first.id, machineId, state: 'ended', errorMessage: null });

		// The index is partial for exactly this reason: a box is a durable
		// thing and playing twice is the ordinary case, so a stopped run must
		// not occupy the slot forever.
		const second = await mk();
		expect(second.id).not.toBe(first.id);
		expect(await Session.listByBox(box.id)).toHaveLength(2);
	});
});

describe('Session tickets and the end of a run', () => {
	test('stopping a run takes its address away', async () => {
		const { machineId, session } = await requestedRun('ses-ticket-cleared', 5452);
		await Session.transition({ id: session.id, machineId, state: 'starting', errorMessage: null });
		await Session.transition({ id: session.id, machineId, state: 'live', errorMessage: null });
		expect(
			(await Session.publishTicket({ id: session.id, machineId, ticket: 'live-address' })).session
				?.ticket
		).toBe('live-address');

		const ended = await Session.transition({
			id: session.id,
			machineId,
			state: 'ended',
			errorMessage: null
		});
		// Publishing an address for a stopped run is already refused, so a
		// kept one would be the only ticket a client can read for a dead run
		// and the one nothing is allowed to replace. It would be dialled.
		expect(ended.outcome).toBe('moved');
		expect(ended.session?.ticket).toBeNull();
		expect((await Session.fromID(session.id))?.ticket).toBeNull();
	});

	test('a run that failed does not keep an address either', async () => {
		const { machineId, session } = await requestedRun('ses-ticket-cleared-fail', 5453);
		await Session.transition({ id: session.id, machineId, state: 'starting', errorMessage: null });
		await Session.publishTicket({ id: session.id, machineId, ticket: 'starting-address' });

		const failed = await Session.transition({
			id: session.id,
			machineId,
			state: 'failed',
			errorMessage: 'the guest never came up'
		});
		expect(failed.session?.ticket).toBeNull();
		// The reason survives; only the address goes.
		expect(failed.session?.errorMessage).toBe('the guest never came up');
	});

	test('the unscoped primitive clears it too, whichever writer stops a run', async () => {
		const { session } = await requestedRun('ses-ticket-cleared-setstate', 5454);
		await Session.setTicket({ id: session.id, ticket: 'an-address' });

		const ended = await Session.setState({
			id: session.id,
			state: 'ended',
			errorMessage: null
		});
		expect(ended?.ticket).toBeNull();
	});
});
