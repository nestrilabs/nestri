import { afterAll, describe, expect, test } from 'bun:test';

import { AccessToken } from '@nestri/core/access-token/index';
import { Box } from '@nestri/core/box/index';
import { Fixtures } from '@nestri/core/db/fixtures';
import { testDb } from '@nestri/core/db/test';
import { Game } from '@nestri/core/game/index';
import { Identifier } from '@nestri/core/id';
import { Machine } from '@nestri/core/machine/index';
import { Session } from '@nestri/core/session/index';

import { app } from '../app/index';
import './setup';

const sql = testDb();

const createdUserIds: string[] = [];
const createdGameIds: string[] = [];

async function newGame(steamAppId: number): Promise<string> {
	const [row] = await Game.upsert({
		id: Identifier.ascending('game'),
		steamAppId,
		slug: `session-route-${steamAppId}`,
		name: `Session Route ${steamAppId}`
	});
	if (!row) throw new Error('expected a game row');
	createdGameIds.push(row.id);
	return row.id;
}

/**
 * Everything one session needs, plus both sets of credentials that reach it.
 *
 * The person authenticates with a personal token, which is the one user
 * credential a test can mint without an auth service; the host authenticates
 * as itself with the secret registration hands back exactly once.
 */
async function scene(label: string, steamAppId: number) {
	const owner = await Fixtures.owner(label);
	createdUserIds.push(owner.userId);

	const registered = await Machine.register({
		id: Identifier.ascending('machine'),
		ownerUserId: owner.userId,
		teamId: owner.teamId,
		label
	});

	const box = await Box.create({
		id: Identifier.ascending('box'),
		userId: owner.userId,
		machineId: registered.id,
		label,
		tier: 'sm'
	});

	const pat = await AccessToken.create({
		id: Identifier.ascending('accessToken'),
		ownerUserId: owner.userId,
		// Null on purpose: a token scoped to the user alone makes the caller a
		// plain user actor, which is the credential a person browsing has.
		teamId: null,
		name: label
	});

	return {
		owner,
		box,
		machineId: registered.id,
		gameId: await newGame(steamAppId),
		user: {
			authorization: `Bearer ${pat.token}`,
			'content-type': 'application/json'
		} as Record<string, string>,
		host: {
			'x-nestri-machine-id': registered.id,
			'x-nestri-machine-secret': registered.secret,
			'content-type': 'application/json'
		} as Record<string, string>
	};
}

async function requestSession(s: Awaited<ReturnType<typeof scene>>) {
	const res = await app.request('/session', {
		method: 'POST',
		headers: s.user,
		body: JSON.stringify({
			boxId: s.box.id,
			gameId: s.gameId,
			linkedAccountId: s.owner.linkedAccountId
		})
	});
	const body = (await res.json()) as any;
	return { res, body };
}

afterAll(async () => {
	if (createdUserIds.length > 0) {
		await sql`delete from "box" where user_id in ${sql(createdUserIds)}`;
		await sql`delete from "user" where id in ${sql(createdUserIds)}`;
		createdUserIds.length = 0;
	}
	if (createdGameIds.length > 0) {
		await sql`delete from "game" where id in ${sql(createdGameIds)}`;
		createdGameIds.length = 0;
	}
});

describe('POST /session', () => {
	test('a request creates the job, in the envelope both ends read', async () => {
		const s = await scene('route-create', 5500);
		const { res, body } = await requestSession(s);

		expect(res.status).toBe(201);
		// The field names are the contract. A rename on either side produces a
		// host that starts, reads nothing, and reports success — so the shape
		// is asserted whole rather than field by field.
		expect(Object.keys(body)).toEqual(['data']);
		expect(body.data).toEqual({
			id: body.data.id,
			boxId: s.box.id,
			gameId: s.gameId,
			linkedAccountId: s.owner.linkedAccountId,
			state: 'requested',
			ticket: null,
			timeStarted: null,
			timeStopped: null,
			errorMessage: null
		});
		expect(body.data.id.startsWith('ses_')).toBe(true);
	});

	test('creating a session makes no placement decision', async () => {
		const s = await scene('route-noplacement', 5501);
		const { body } = await requestSession(s);

		// A session inherits its machine through its box, so there is nothing
		// to choose here and no way for a caller to ask for a host.
		expect(body.data).not.toHaveProperty('machineId');

		const withHost = await app.request('/session', {
			method: 'POST',
			headers: s.user,
			body: JSON.stringify({
				boxId: s.box.id,
				gameId: s.gameId,
				linkedAccountId: s.owner.linkedAccountId,
				machineId: s.machineId
			})
		});
		expect(withHost.status).toBe(400);
	});

	test('a box somebody else owns is not there to run', async () => {
		const mine = await scene('route-mine', 5502);
		const theirs = await scene('route-theirs', 5503);

		const res = await app.request('/session', {
			method: 'POST',
			headers: mine.user,
			body: JSON.stringify({
				boxId: theirs.box.id,
				gameId: mine.gameId,
				linkedAccountId: mine.owner.linkedAccountId
			})
		});
		expect(res.status).toBe(404);

		const unknown = await app.request('/session', {
			method: 'POST',
			headers: mine.user,
			body: JSON.stringify({
				boxId: Identifier.ascending('box'),
				gameId: mine.gameId,
				linkedAccountId: mine.owner.linkedAccountId
			})
		});
		// Owner-scoped in the query, so somebody else's box and a box that was
		// never created are the same answer.
		expect(unknown.status).toBe(404);
		expect(await res.json()).toEqual(await unknown.json());
	});

	test('a box already running refuses a second run rather than picking one', async () => {
		const s = await scene('route-busy', 5504);
		expect((await requestSession(s)).res.status).toBe(201);

		const second = await requestSession(s);
		expect(second.res.status).toBe(409);
		expect(second.body.type).toBe('already_exists');
	});

	test('two requests racing for one box still start it once', async () => {
		const s = await scene('route-race', 5509);
		const [a, b] = await Promise.all([requestSession(s), requestSession(s)]);

		// Which request wins is a timing detail; that exactly one does is not.
		// The pre-check and the unique index answer identically, so the loser
		// cannot tell which caught it.
		//
		// This asserts the endpoint's answer, not the invariant: two requests
		// in one process usually interleave such that the pre-check catches
		// the second, so it passes with the unique index dropped. The index is
		// pinned in the core tests, where both callers can be made to read
		// before either writes.
		const statuses = [a.res.status, b.res.status].sort();
		expect(statuses).toEqual([201, 409]);
		expect([a.body, b.body].find((x) => x.type)?.type).toBe('already_exists');

		expect(await Session.listByBox(s.box.id)).toHaveLength(1);
		// The failure this prevents: the host offered the same box twice.
		const jobs = await app.request('/machine/jobs', { headers: s.host });
		expect(((await jobs.json()) as any).data).toHaveLength(1);
	});

	test('you can only play as an account you have linked', async () => {
		const mine = await scene('route-account-mine', 5505);
		const theirs = await scene('route-account-theirs', 5506);

		const res = await app.request('/session', {
			method: 'POST',
			headers: mine.user,
			body: JSON.stringify({
				boxId: mine.box.id,
				gameId: mine.gameId,
				linkedAccountId: theirs.owner.linkedAccountId
			})
		});
		expect(res.status).toBe(403);
	});

	test('an unknown game is a 404 and not a foreign key crash', async () => {
		const s = await scene('route-nogame', 5507);
		const res = await app.request('/session', {
			method: 'POST',
			headers: s.user,
			body: JSON.stringify({
				boxId: s.box.id,
				gameId: Identifier.ascending('game'),
				linkedAccountId: s.owner.linkedAccountId
			})
		});
		expect(res.status).toBe(404);
	});

	test('a host cannot ask for a session on its owner’s behalf', async () => {
		const s = await scene('route-hostcreate', 5508);
		const res = await app.request('/session', {
			method: 'POST',
			headers: s.host,
			body: JSON.stringify({
				boxId: s.box.id,
				gameId: s.gameId,
				linkedAccountId: s.owner.linkedAccountId
			})
		});
		// A box holds credentials but is not the person who owns it.
		expect(res.status).toBe(403);
	});

	test('requesting a session requires a signed-in person', async () => {
		const res = await app.request('/session', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ boxId: 'box_x', gameId: 'gam_x', linkedAccountId: 'lac_x' })
		});
		expect(res.status).toBe(401);
	});
});

describe('GET /session/:id', () => {
	test('the owner reads their own run, ticket and all', async () => {
		const s = await scene('route-read', 5510);
		const { body } = await requestSession(s);

		await app.request(`/session/${body.data.id}/state`, {
			method: 'POST',
			headers: s.host,
			body: JSON.stringify({ state: 'starting' })
		});
		await app.request(`/session/${body.data.id}/ticket`, {
			method: 'POST',
			headers: s.host,
			body: JSON.stringify({ ticket: 'nodeaaa-one' })
		});

		const res = await app.request(`/session/${body.data.id}`, { headers: s.user });
		expect(res.status).toBe(200);
		const read = (await res.json()) as any;
		expect(read.data.state).toBe('starting');
		// A ticket may appear while the state is still `starting`, and the
		// client is expected to re-read rather than cache the first one.
		expect(read.data.ticket).toBe('nodeaaa-one');
	});

	test('somebody else’s run is not visible, and neither is its absence', async () => {
		const mine = await scene('route-read-mine', 5511);
		const theirs = await scene('route-read-theirs', 5512);
		const { body } = await requestSession(theirs);

		const forbidden = await app.request(`/session/${body.data.id}`, { headers: mine.user });
		const unknown = await app.request(`/session/${Identifier.ascending('session')}`, {
			headers: mine.user
		});
		expect(forbidden.status).toBe(404);
		expect(unknown.status).toBe(404);
		expect(await forbidden.json()).toEqual(await unknown.json());
	});

	test('reading a run requires a signed-in person', async () => {
		const res = await app.request('/session/ses_whatever');
		expect(res.status).toBe(401);
	});
});

describe('GET /machine/jobs', () => {
	test('a host is handed the work for its own boxes, with the kind on the wire', async () => {
		const s = await scene('route-jobs', 5520);
		const { body } = await requestSession(s);

		const res = await app.request('/machine/jobs', { headers: s.host });
		expect(res.status).toBe(200);
		const jobs = (await res.json()) as any;
		expect(Object.keys(jobs)).toEqual(['data']);
		expect(jobs.data).toHaveLength(1);
		expect(jobs.data[0]).toEqual({
			kind: 'session.start',
			sessionId: body.data.id,
			boxId: s.box.id,
			boxTier: 'sm',
			gameId: s.gameId,
			steamAppId: 5520,
			linkedAccountId: s.owner.linkedAccountId
		});
	});

	test('a host never sees work for a box on other hardware', async () => {
		const mine = await scene('route-jobs-mine', 5521);
		const theirs = await scene('route-jobs-theirs', 5522);
		await requestSession(theirs);

		const res = await app.request('/machine/jobs', { headers: mine.host });
		expect(res.status).toBe(200);
		// Scoped in the query rather than by the host asking for its own work.
		expect(((await res.json()) as any).data).toEqual([]);
	});

	test('bad credentials are indistinguishable from none', async () => {
		const s = await scene('route-jobs-auth', 5523);
		const wrong = await app.request('/machine/jobs', {
			headers: { ...s.host, 'x-nestri-machine-secret': 'msk_wrong' }
		});
		const none = await app.request('/machine/jobs');
		expect(wrong.status).toBe(403);
		expect(none.status).toBe(403);
		// Bad credentials fall through to public and are then forbidden, so
		// probing tells an attacker nothing. Asserting the two are identical is
		// the only way that stays true.
		expect(await wrong.json()).toEqual(await none.json());
	});

	test('a person cannot poll for jobs', async () => {
		const s = await scene('route-jobs-person', 5524);
		const res = await app.request('/machine/jobs', { headers: s.user });
		expect(res.status).toBe(403);
	});
});

describe('POST /session/:id/state', () => {
	test('the claim moves the row, and the job stops being offered', async () => {
		const s = await scene('route-claim', 5530);
		const { body } = await requestSession(s);

		const res = await app.request(`/session/${body.data.id}/state`, {
			method: 'POST',
			headers: s.host,
			body: JSON.stringify({ state: 'starting' })
		});
		expect(res.status).toBe(200);
		expect(((await res.json()) as any).data.state).toBe('starting');

		const jobs = await app.request('/machine/jobs', { headers: s.host });
		expect(((await jobs.json()) as any).data).toEqual([]);
	});

	test('the same host re-reporting a state it already reported is fine', async () => {
		const s = await scene('route-claim-retry', 5531);
		const { body } = await requestSession(s);

		const report = () =>
			app.request(`/session/${body.data.id}/state`, {
				method: 'POST',
				headers: s.host,
				body: JSON.stringify({ state: 'starting' })
			});

		expect((await report()).status).toBe(200);
		// An agent retrying after a lost response must not be told it broke
		// something.
		const again = await report();
		expect(again.status).toBe(200);
		expect(((await again.json()) as any).data.state).toBe('starting');
	});

	test('a different host reporting anything is refused, and learns nothing', async () => {
		const mine = await scene('route-claim-mine', 5532);
		const theirs = await scene('route-claim-theirs', 5533);
		const { body } = await requestSession(theirs);

		const other = await app.request(`/session/${body.data.id}/state`, {
			method: 'POST',
			headers: mine.host,
			body: JSON.stringify({ state: 'starting' })
		});
		const unknown = await app.request(`/session/${Identifier.ascending('session')}/state`, {
			method: 'POST',
			headers: mine.host,
			body: JSON.stringify({ state: 'starting' })
		});

		expect(other.status).toBe(403);
		expect(unknown.status).toBe(403);
		expect(await other.json()).toEqual(await unknown.json());
		expect((await Session.fromID(body.data.id))?.state).toBe('requested');
	});

	test('a transition that is not allowed is a conflict, and the row stays put', async () => {
		const s = await scene('route-claim-illegal', 5534);
		const { body } = await requestSession(s);

		const skipped = await app.request(`/session/${body.data.id}/state`, {
			method: 'POST',
			headers: s.host,
			body: JSON.stringify({ state: 'live' })
		});
		expect(skipped.status).toBe(409);
		expect((await Session.fromID(body.data.id))?.state).toBe('requested');
	});

	test('a stopped run cannot be started again', async () => {
		const s = await scene('route-claim-terminal', 5535);
		const { body } = await requestSession(s);
		const report = (state: string, errorMessage?: string) =>
			app.request(`/session/${body.data.id}/state`, {
				method: 'POST',
				headers: s.host,
				body: JSON.stringify({ state, errorMessage })
			});

		expect((await report('starting')).status).toBe(200);
		expect((await report('failed', 'the guest never came up')).status).toBe(200);
		expect((await report('starting')).status).toBe(409);

		const failed = await Session.fromID(body.data.id);
		expect(failed?.state).toBe('failed');
		expect(failed?.errorMessage).toBe('the guest never came up');
	});

	test('a duplicate live report does not extend a run somebody is billed for', async () => {
		const s = await scene('route-claim-billing', 5536);
		const { body } = await requestSession(s);
		const report = (state: string) =>
			app.request(`/session/${body.data.id}/state`, {
				method: 'POST',
				headers: s.host,
				body: JSON.stringify({ state })
			});

		await report('starting');
		const live = (await (await report('live')).json()) as any;
		expect(live.data.timeStarted).not.toBeNull();

		const again = (await (await report('live')).json()) as any;
		expect(again.data.timeStarted).toBe(live.data.timeStarted);
	});

	test('a state nobody defined is a validation error, not a conflict', async () => {
		const s = await scene('route-claim-bogus', 5537);
		const { body } = await requestSession(s);
		const res = await app.request(`/session/${body.data.id}/state`, {
			method: 'POST',
			headers: s.host,
			body: JSON.stringify({ state: 'exploded' })
		});
		expect(res.status).toBe(400);
	});

	test('a person cannot report a state on their own session', async () => {
		const s = await scene('route-claim-person', 5538);
		const { body } = await requestSession(s);
		const res = await app.request(`/session/${body.data.id}/state`, {
			method: 'POST',
			headers: s.user,
			body: JSON.stringify({ state: 'starting' })
		});
		// Terminal states are written by the agent alone; a person closing the
		// app is not the same fact as a run that stopped.
		expect(res.status).toBe(403);
	});
});

describe('POST /session/:id/ticket', () => {
	test('a later ticket replaces the first, because it is a better address', async () => {
		const s = await scene('route-ticket', 5540);
		const { body } = await requestSession(s);
		await app.request(`/session/${body.data.id}/state`, {
			method: 'POST',
			headers: s.host,
			body: JSON.stringify({ state: 'starting' })
		});

		const publish = (ticket: string) =>
			app.request(`/session/${body.data.id}/ticket`, {
				method: 'POST',
				headers: s.host,
				body: JSON.stringify({ ticket })
			});

		const first = await publish('nodeaaa-one');
		expect(first.status).toBe(200);
		expect(((await first.json()) as any).data.ticket).toBe('nodeaaa-one');

		const second = await publish('nodeaaa-two');
		expect(((await second.json()) as any).data.ticket).toBe('nodeaaa-two');
		expect(await Session.listByBox(s.box.id)).toHaveLength(1);
	});

	test('a different host cannot publish an address for someone else’s run', async () => {
		const mine = await scene('route-ticket-mine', 5541);
		const theirs = await scene('route-ticket-theirs', 5542);
		const { body } = await requestSession(theirs);

		const res = await app.request(`/session/${body.data.id}/ticket`, {
			method: 'POST',
			headers: mine.host,
			body: JSON.stringify({ ticket: 'nodeaaa-stolen' })
		});
		expect(res.status).toBe(403);
		expect((await Session.fromID(body.data.id))?.ticket).toBeNull();
	});

	test('a stopped run has no address to publish', async () => {
		const s = await scene('route-ticket-dead', 5543);
		const { body } = await requestSession(s);
		const report = (state: string) =>
			app.request(`/session/${body.data.id}/state`, {
				method: 'POST',
				headers: s.host,
				body: JSON.stringify({ state })
			});
		await report('starting');
		await report('live');
		await report('ended');

		const res = await app.request(`/session/${body.data.id}/ticket`, {
			method: 'POST',
			headers: s.host,
			body: JSON.stringify({ ticket: 'nodeaaa-late' })
		});
		expect(res.status).toBe(409);
		expect((await Session.fromID(body.data.id))?.ticket).toBeNull();
	});

	test('a run that stops loses the address it published', async () => {
		const s = await scene('route-ticket-cleared', 5545);
		const { body } = await requestSession(s);
		const report = (state: string) =>
			app.request(`/session/${body.data.id}/state`, {
				method: 'POST',
				headers: s.host,
				body: JSON.stringify({ state })
			});
		await report('starting');
		await report('live');
		const published = await app.request(`/session/${body.data.id}/ticket`, {
			method: 'POST',
			headers: s.host,
			body: JSON.stringify({ ticket: 'nodeaaa-live' })
		});
		expect(((await published.json()) as any).data.ticket).toBe('nodeaaa-live');

		await report('ended');

		// The polling client is the reason. It reads this endpoint until it has
		// an address, and an address left behind by a run that stopped is one
		// it would dial — while publishing a replacement is already refused.
		const read = await app.request(`/session/${body.data.id}`, { headers: s.user });
		const after = (await read.json()) as any;
		expect(after.data.state).toBe('ended');
		expect(after.data.ticket).toBeNull();
	});

	test('a ticket has to say something', async () => {
		const s = await scene('route-ticket-empty', 5544);
		const { body } = await requestSession(s);
		const res = await app.request(`/session/${body.data.id}/ticket`, {
			method: 'POST',
			headers: s.host,
			body: JSON.stringify({ ticket: '' })
		});
		expect(res.status).toBe(400);
	});
});

describe('Session routes in the spec', () => {
	test('every path a caller needs is documented', async () => {
		const res = await app.request('/doc');
		const paths = Object.keys(((await res.json()) as any).paths);
		expect(paths).toContain('/session');
		expect(paths).toContain('/session/{id}');
		expect(paths).toContain('/session/{id}/state');
		expect(paths).toContain('/session/{id}/ticket');
		expect(paths).toContain('/machine/jobs');
	});
});
