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

/**
 * Two attempts, so a test that means "the holder" cannot pass by accident on a
 * value that every caller in the file happens to share.
 */
const HOLDER = 'h'.repeat(32);
const RIVAL = 'r'.repeat(32);

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
			claimToken: HOLDER,
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
			claimToken: HOLDER,
			id: session.id,
			machineId,
			from: 'requested',
			to: 'starting',
			errorMessage: null
		});
		expect(won?.state).toBe('starting');

		// A second attempt, with a token of its own. The row is no longer
		// `requested` and it already has a holder, so the update matches
		// nothing — which is what stops two agents from both starting the same
		// box. Updating on the id alone would succeed twice.
		const lost = await Session.compareAndSetState({
			claimToken: RIVAL,
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
			claimToken: HOLDER,
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
				claimToken: HOLDER,
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
			claimToken: HOLDER,
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

		await Session.transition({ claimToken: HOLDER, id: session.id, machineId, state: 'starting', errorMessage: null });
		const again = await Session.transition({
			claimToken: HOLDER,
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
			claimToken: HOLDER,
			id: session.id,
			machineId,
			state: 'live',
			errorMessage: null
		});
		expect(skipped.outcome).toBe('illegal');
		expect((await Session.fromID(session.id))?.state).toBe('requested');

		await Session.transition({ claimToken: HOLDER, id: session.id, machineId, state: 'starting', errorMessage: null });
		await Session.transition({ claimToken: HOLDER, id: session.id, machineId, state: 'failed', errorMessage: 'no' });

		// Terminal is terminal: a dead session cannot be resurrected.
		const raised = await Session.transition({
			claimToken: HOLDER,
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
		await Session.transition({ claimToken: HOLDER, id: session.id, machineId, state: 'starting', errorMessage: null });
		const live = await Session.transition({
			claimToken: HOLDER,
			id: session.id,
			machineId,
			state: 'live',
			errorMessage: null
		});
		expect(live.session?.timeStarted).not.toBeNull();

		const repeat = await Session.transition({
			claimToken: HOLDER,
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

		await Session.transition({ claimToken: HOLDER, id: session.id, machineId, state: 'starting', errorMessage: null });

		const refused = await Session.publishTicket({
			claimToken: HOLDER,
			id: session.id,
			machineId: other.machineId,
			ticket: 'stolen'
		});
		expect(refused.outcome).toBe('forbidden');
		expect((await Session.fromID(session.id))?.ticket).toBeNull();

		// A ticket may appear while the state is still `starting`.
		const first = await Session.publishTicket({ claimToken: HOLDER, id: session.id, machineId, ticket: 'one' });
		expect(first.outcome).toBe('published');
		expect(first.session?.ticket).toBe('one');
		expect(first.session?.state).toBe('starting');

		const second = await Session.publishTicket({ claimToken: HOLDER, id: session.id, machineId, ticket: 'two' });
		expect(second.session?.ticket).toBe('two');
	});

	test('two attempts claiming at once produce exactly one winner', async () => {
		const { machineId, session } = await requested('ses-cas-race', 5446);

		// Both launched before either has finished, so this is the case the
		// sequential tests cannot reach: two attempts that may each read the
		// run as unclaimed before either writes. Postgres holds the second
		// update on the row lock until the first commits and then re-checks
		// the predicate, so the loser matches nothing.
		const [a, b] = await Promise.all([
			Session.transition({
				claimToken: HOLDER,
				id: session.id,
				machineId,
				state: 'starting',
				errorMessage: null
			}),
			Session.transition({
				claimToken: RIVAL,
				id: session.id,
				machineId,
				state: 'starting',
				errorMessage: null
			})
		]);

		const outcomes = [a.outcome, b.outcome];
		// The assertion that matters, and the only one that would catch the
		// predicate being weakened: not which one won, but that one did.
		expect(outcomes.filter((o) => o === 'moved')).toHaveLength(1);
		// Which refusal the loser gets depends on whether its read landed
		// before or after the winner's commit, and that is timing. Both mean
		// the same thing to an agent — stop, this run is not yours.
		expect(['lost', 'notHolder']).toContain(outcomes.find((o) => o !== 'moved'));
		expect((await Session.fromID(session.id))?.state).toBe('starting');

		// And the row holds the winner, not merely somebody: the attempt that
		// was told it moved can report again and the other still cannot.
		const winner = a.outcome === 'moved' ? HOLDER : RIVAL;
		const loser = winner === HOLDER ? RIVAL : HOLDER;
		expect(
			(
				await Session.transition({
					claimToken: winner,
					id: session.id,
					machineId,
					state: 'starting',
					errorMessage: null
				})
			).outcome
		).toBe('unchanged');
		expect(
			(
				await Session.transition({
					claimToken: loser,
					id: session.id,
					machineId,
					state: 'starting',
					errorMessage: null
				})
			).outcome
		).toBe('notHolder');
	});

	test('the guarded update alone refuses the second claim, without the read', async () => {
		const { machineId, session } = await requested('ses-cas-race-raw', 5447);

		// The test above depends on how two transactions interleave, so it can
		// pass for the wrong reason on a run where one finishes first. This one
		// cannot: it skips the read and fires both guarded updates, so the only
		// thing that can refuse the second is the predicate in the `where`
		// clause. Separating the check from the write would fail here.
		const both = await Promise.all([
			Session.compareAndSetState({
				claimToken: HOLDER,
				id: session.id,
				machineId,
				from: 'requested',
				to: 'starting',
				errorMessage: null
			}),
			Session.compareAndSetState({
				claimToken: RIVAL,
				id: session.id,
				machineId,
				from: 'requested',
				to: 'starting',
				errorMessage: null
			})
		]);

		expect(both.filter((row) => row !== null)).toHaveLength(1);
		expect((await Session.fromID(session.id))?.state).toBe('starting');
	});

	test('the claim writes a holder, and the holder never goes out', async () => {
		const { machineId, session } = await requested('ses-holder', 5440);

		const claimed = await Session.transition({
			claimToken: HOLDER,
			id: session.id,
			machineId,
			state: 'starting',
			errorMessage: null
		});
		expect(claimed.outcome).toBe('moved');
		// Holding one permits writing to a run, including publishing the
		// address a client will dial. It is carried by nothing that is
		// serialized, and this is the assertion that keeps it that way.
		expect(claimed.session).not.toHaveProperty('claimToken');
		expect(await Session.fromID(session.id)).not.toHaveProperty('claimToken');
	});

	test('a rival claiming the same run is refused, and sees only that it is held', async () => {
		const { machineId, session } = await requested('ses-held', 5441);
		await Session.transition({
			claimToken: HOLDER,
			id: session.id,
			machineId,
			state: 'starting',
			errorMessage: null
		});

		// Taking the claim and leaving `requested` are one write, so a rival
		// polling the same job never finds a `requested` run with a holder —
		// it finds a `starting` one it does not hold. There is no second
		// answer to give it, and this is the only one.
		const second = await Session.transition({
			claimToken: RIVAL,
			id: session.id,
			machineId,
			state: 'starting',
			errorMessage: null
		});
		expect(second.outcome).toBe('notHolder');
	});

	test('the same state from a different attempt is a lost race and not a retry', async () => {
		const { machineId, session } = await requested('ses-rival-same', 5442);
		await Session.transition({
			claimToken: HOLDER,
			id: session.id,
			machineId,
			state: 'starting',
			errorMessage: null
		});

		// Same machine, same credentials, same state the run is already in.
		// The holder is the only thing separating this call from the one below
		// it, and without the column both would be answered the same way.
		const rival = await Session.transition({
			claimToken: RIVAL,
			id: session.id,
			machineId,
			state: 'starting',
			errorMessage: null
		});
		expect(rival.outcome).toBe('notHolder');

		const retry = await Session.transition({
			claimToken: HOLDER,
			id: session.id,
			machineId,
			state: 'starting',
			errorMessage: null
		});
		expect(retry.outcome).toBe('unchanged');
	});

	test('a run does not move onwards for an attempt that does not hold it', async () => {
		const { machineId, session } = await requested('ses-rival-move', 5443);
		await Session.transition({
			claimToken: HOLDER,
			id: session.id,
			machineId,
			state: 'starting',
			errorMessage: null
		});

		const stolen = await Session.transition({
			claimToken: RIVAL,
			id: session.id,
			machineId,
			state: 'live',
			errorMessage: null
		});
		expect(stolen.outcome).toBe('notHolder');
		expect((await Session.fromID(session.id))?.state).toBe('starting');
	});

	test('the holder outlives the run, so a settled claim cannot be replayed', async () => {
		const { machineId, session } = await requested('ses-holder-kept', 5444);
		for (const state of ['starting', 'live', 'ended'] as const) {
			await Session.transition({
				claimToken: HOLDER,
				id: session.id,
				machineId,
				state,
				errorMessage: null
			});
		}

		// Reported at the state the run is already in, so the answer turns on
		// the holder and on nothing else. Were the column cleared on a terminal
		// state, the rival would match a null holder and be told `unchanged` —
		// a dead claim answered as though it were the live one.
		const replay = await Session.transition({
			claimToken: RIVAL,
			id: session.id,
			machineId,
			state: 'ended',
			errorMessage: null
		});
		expect(replay.outcome).toBe('notHolder');

		const holder = await Session.transition({
			claimToken: HOLDER,
			id: session.id,
			machineId,
			state: 'ended',
			errorMessage: null
		});
		expect(holder.outcome).toBe('unchanged');
	});

	test('a losing attempt cannot publish an address over the winner’s', async () => {
		const { machineId, session } = await requested('ses-ticket-holder', 5445);
		await Session.transition({
			claimToken: HOLDER,
			id: session.id,
			machineId,
			state: 'starting',
			errorMessage: null
		});
		await Session.publishTicket({
			claimToken: HOLDER,
			id: session.id,
			machineId,
			ticket: 'the-winner'
		});

		// The same machine, so the scope check passes and lets this through to
		// the holder. Without that check the write would land, the client would
		// re-read it rather than keeping the first, and it would connect —
		// successfully — to a box nobody is running.
		const stolen = await Session.publishTicket({
			claimToken: RIVAL,
			id: session.id,
			machineId,
			ticket: 'the-wrong-machine'
		});
		expect(stolen.outcome).toBe('notHolder');
		expect((await Session.fromID(session.id))?.ticket).toBe('the-winner');
	});

	test('a stopped session has no address to publish', async () => {
		const { machineId, session } = await requested('ses-ticket-dead', 5429);
		await Session.transition({ claimToken: HOLDER, id: session.id, machineId, state: 'starting', errorMessage: null });
		await Session.transition({ claimToken: HOLDER, id: session.id, machineId, state: 'live', errorMessage: null });
		await Session.transition({ claimToken: HOLDER, id: session.id, machineId, state: 'ended', errorMessage: null });

		const result = await Session.publishTicket({ claimToken: HOLDER, id: session.id, machineId, ticket: 'late' });
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
		await Session.transition({ claimToken: HOLDER, id: first.id, machineId, state: 'starting', errorMessage: null });
		await Session.transition({ claimToken: HOLDER, id: first.id, machineId, state: 'live', errorMessage: null });
		await Session.transition({ claimToken: HOLDER, id: first.id, machineId, state: 'ended', errorMessage: null });

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
		await Session.transition({ claimToken: HOLDER, id: session.id, machineId, state: 'starting', errorMessage: null });
		await Session.transition({ claimToken: HOLDER, id: session.id, machineId, state: 'live', errorMessage: null });
		expect(
			(await Session.publishTicket({ claimToken: HOLDER, id: session.id, machineId, ticket: 'live-address' })).session
				?.ticket
		).toBe('live-address');

		const ended = await Session.transition({
			claimToken: HOLDER,
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
		await Session.transition({ claimToken: HOLDER, id: session.id, machineId, state: 'starting', errorMessage: null });
		await Session.publishTicket({ claimToken: HOLDER, id: session.id, machineId, ticket: 'starting-address' });

		const failed = await Session.transition({
			claimToken: HOLDER,
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

describe('Session and the box underneath it', () => {
	test('a live run is what makes its box running', async () => {
		const { machineId, box, session } = await requestedRun('ses-box-live', 5460);
		// A box starts out `created` and nothing had ever moved it, so it read
		// `created` while a run on it was `live`.
		expect((await Box.fromID(box.id))?.state).toBe('created');

		await Session.transition({ claimToken: HOLDER, id: session.id, machineId, state: 'starting', errorMessage: null });
		// `starting` is deliberately not a box state: that transition is
		// synchronous from the agent's side, so nothing would ever write it.
		expect((await Box.fromID(box.id))?.state).toBe('created');

		await Session.transition({ claimToken: HOLDER, id: session.id, machineId, state: 'live', errorMessage: null });
		const running = await Box.fromID(box.id);
		expect(running?.state).toBe('running');
		expect(running?.stopReason).toBeNull();
		expect(running?.stopClean).toBeNull();
	});

	test('a run that ends stops its box, cleanly', async () => {
		const { machineId, box, session } = await requestedRun('ses-box-ended', 5461);
		await Session.transition({ claimToken: HOLDER, id: session.id, machineId, state: 'starting', errorMessage: null });
		await Session.transition({ claimToken: HOLDER, id: session.id, machineId, state: 'live', errorMessage: null });
		await Session.transition({ claimToken: HOLDER, id: session.id, machineId, state: 'ended', errorMessage: null });

		const stopped = await Box.fromID(box.id);
		expect(stopped?.state).toBe('stopped');
		expect(stopped?.stopClean).toBe(true);
		expect(stopped?.stopReason).toBeNull();
	});

	test('a run that fails stops its box in the words the agent used', async () => {
		const { machineId, box, session } = await requestedRun('ses-box-failed', 5462);
		await Session.transition({ claimToken: HOLDER, id: session.id, machineId, state: 'starting', errorMessage: null });
		await Session.transition({
			claimToken: HOLDER,
			id: session.id,
			machineId,
			state: 'failed',
			errorMessage: 'the guest never came up'
		});

		const stopped = await Box.fromID(box.id);
		expect(stopped?.state).toBe('stopped');
		// "It is not running" and "it faulted" are different facts, and the
		// difference lives in the reason rather than in a fourth state.
		expect(stopped?.stopClean).toBe(false);
		expect(stopped?.stopReason).toBe('the guest never came up');
	});

	test('a refused report leaves the box alone', async () => {
		const { machineId, box, session } = await requestedRun('ses-box-untouched', 5463);
		const other = await scene('ses-box-otherhost', 5464);

		const refused = await Session.transition({
			claimToken: HOLDER,
			id: session.id,
			machineId: other.machineId,
			state: 'starting',
			errorMessage: null
		});
		expect(refused.outcome).toBe('forbidden');

		// An illegal transition does not move the run, so it must not move the
		// box either — otherwise the box records a run that never happened.
		const illegal = await Session.transition({
			claimToken: HOLDER,
			id: session.id,
			machineId,
			state: 'live',
			errorMessage: null
		});
		expect(illegal.outcome).toBe('illegal');
		expect((await Box.fromID(box.id))?.state).toBe('created');
	});
});

describe('Session tickets need a claim first', () => {
	test('a run nobody has claimed has no address to publish', async () => {
		const { machineId, session } = await requestedRun('ses-ticket-unclaimed', 5465);

		// A ticket is the address of something being brought up, so publishing
		// one for a `requested` run means the agent skipped the claim — the
		// step that is the only mutual exclusion in the design.
		const early = await Session.publishTicket({ claimToken: HOLDER, id: session.id, machineId, ticket: 'too-soon' });
		expect(early.outcome).toBe('unclaimed');
		expect((await Session.fromID(session.id))?.ticket).toBeNull();

		await Session.transition({ claimToken: HOLDER, id: session.id, machineId, state: 'starting', errorMessage: null });
		const now = await Session.publishTicket({ claimToken: HOLDER, id: session.id, machineId, ticket: 'in-time' });
		expect(now.outcome).toBe('published');
		expect(now.session?.ticket).toBe('in-time');
	});

	test('the two refusals are different answers, because they are different mistakes', async () => {
		const { machineId, session } = await requestedRun('ses-ticket-refusals', 5466);
		const unclaimed = await Session.publishTicket({ claimToken: HOLDER, id: session.id, machineId, ticket: 'a' });

		await Session.transition({ claimToken: HOLDER, id: session.id, machineId, state: 'starting', errorMessage: null });
		await Session.transition({ claimToken: HOLDER, id: session.id, machineId, state: 'live', errorMessage: null });
		await Session.transition({ claimToken: HOLDER, id: session.id, machineId, state: 'ended', errorMessage: null });
		const closed = await Session.publishTicket({ claimToken: HOLDER, id: session.id, machineId, ticket: 'b' });

		// One is an agent that has not claimed the work; the other is a run
		// with nothing left to reach. Collapsing them would tell an agent
		// retrying the wrong thing.
		expect(unclaimed.outcome).toBe('unclaimed');
		expect(closed.outcome).toBe('closed');
	});
});
