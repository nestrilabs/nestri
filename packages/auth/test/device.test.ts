import { afterEach, beforeEach, describe, expect, setSystemTime, test } from 'bun:test';

import { object, string } from 'valibot';

import { hashDeviceCode, MemoryDeviceStore } from '../src/device.js';
import { issuer } from '../src/issuer.js';
import { MemoryStorage } from '../src/storage/memory.js';
import { createSubjects } from '../src/subject.js';

const subjects = createSubjects({
	user: object({
		userID: string()
	})
});

const deviceStore = MemoryDeviceStore();

const auth = issuer({
	storage: MemoryStorage(),
	deviceStore,
	subjects,
	allow: async () => true,
	allowDeviceClient: async (clientID) => clientID !== 'banned',
	deviceVerification: { guessLimit: 3, guessWindow: 60 },
	providers: {
		dummy: {
			type: 'dummy',
			init(route, ctx) {
				route.get('/authorize', async (c) => {
					return ctx.success(c, { email: 'foo@bar.com' });
				});
			}
		}
	},
	success: async (ctx) => ctx.subject('user', { userID: '123' })
});

const ORIGIN = 'https://auth.example.com';

/** Two cookies are in play across this flow, and `get` returns only the first. */
function jar() {
	const cookies = new Map<string, string>();
	return {
		absorb(response: Response) {
			for (const raw of response.headers.getSetCookie()) {
				const [pair] = raw.split(';');
				const index = pair!.indexOf('=');
				cookies.set(pair!.slice(0, index), pair!.slice(index + 1));
			}
		},
		header() {
			return [...cookies].map(([name, value]) => `${name}=${value}`).join('; ');
		}
	};
}

async function begin(clientID = 'desktop') {
	const response = await auth.request(`${ORIGIN}/device/authorize`, {
		method: 'POST',
		headers: { 'content-type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({ client_id: clientID })
	});
	return {
		status: response.status,
		body: (await response.json()) as any
	};
}

async function started(clientID = 'desktop') {
	const response = await begin(clientID);
	expect(response.status).toBe(200);
	return response.body as {
		device_code: string;
		user_code: string;
		verification_uri: string;
		verification_uri_complete: string;
		expires_in: number;
		interval: number;
	};
}

async function poll(deviceCode: string, clientID = 'desktop') {
	const response = await auth.request(`${ORIGIN}/token`, {
		method: 'POST',
		headers: { 'content-type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({
			grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
			device_code: deviceCode,
			client_id: clientID
		})
	});
	return { status: response.status, body: (await response.json()) as any };
}

/**
 * Walk the browser half as far as the question, and stop there.
 *
 * Returns the confirmation page and the cookies that go with it, so a test can
 * assert what has and has not happened at the moment somebody has signed in
 * but not yet said yes.
 */
async function signInAndReachConfirmation(userCode: string) {
	const cookies = jar();
	const entered = await auth.request(`${ORIGIN}/device?user_code=${encodeURIComponent(userCode)}`);
	expect(entered.status).toBe(302);
	cookies.absorb(entered);

	const asked = await auth.request(new URL(entered.headers.get('location')!, ORIGIN).toString(), {
		headers: { cookie: cookies.header() }
	});
	cookies.absorb(asked);
	const html = await asked.text();
	return { status: asked.status, html, cookies };
}

/** The whole browser half, ending in an answer. */
async function answer(userCode: string, action: 'approve' | 'deny') {
	const { html, cookies, status } = await signInAndReachConfirmation(userCode);
	expect(status).toBe(200);
	const csrf = /name="csrf" value="([^"]+)"/.exec(html)?.[1];
	expect(csrf).toBeTruthy();

	return auth.request(`${ORIGIN}/device/confirm`, {
		method: 'POST',
		headers: { cookie: cookies.header(), 'content-type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({ csrf: csrf!, action })
	});
}

beforeEach(() => setSystemTime(new Date('2026-01-01T00:00:00Z')));
afterEach(() => setSystemTime());

describe('device authorization request', () => {
	test('answers with everything the polling client needs', async () => {
		const grant = await started();

		expect(grant.device_code).toMatch(/.+/);
		// Eight characters, so the client's four-and-four chunking reads
		// evenly when a person says it out loud.
		expect(grant.user_code).toMatch(/^[A-Z0-9]{8}$/);
		expect(grant.verification_uri).toBe(`${ORIGIN}/device`);
		expect(grant.verification_uri_complete).toContain(grant.user_code);
		expect(grant.interval).toBeGreaterThanOrEqual(1);
		expect(grant.expires_in).toBeGreaterThan(grant.interval);
	});

	test('two requests do not collide', async () => {
		const a = await started();
		const b = await started();
		expect(a.device_code).not.toBe(b.device_code);
		expect(a.user_code).not.toBe(b.user_code);
	});

	test('the metadata document advertises the endpoint and the grant', async () => {
		const response = await auth.request(`${ORIGIN}/.well-known/oauth-authorization-server`);
		const body: any = await response.json();
		expect(body.device_authorization_endpoint).toBe(`${ORIGIN}/device/authorize`);
		expect(body.grant_types_supported).toContain('urn:ietf:params:oauth:grant-type:device_code');
	});

	test('a client the issuer does not know is refused a grant', async () => {
		const refused = await begin('banned');
		expect(refused.status).toBe(400);
		expect(refused.body.error).toBe('invalid_client');
	});

	// The endpoint hands the code back exactly once, in its answer. What is
	// kept is a hash, so reading the store is not enough to redeem anything.
	test('the code the client is given is not the value that is stored', async () => {
		const grant = await started();
		expect(await deviceStore.byDeviceCode(grant.device_code)).toBeNull();
		expect(await deviceStore.byDeviceCode(await hashDeviceCode(grant.device_code))).not.toBeNull();
	});
});

describe('polling', () => {
	test('an unapproved code is pending', async () => {
		const grant = await started();
		const first = await poll(grant.device_code);
		expect(first.status).toBe(400);
		expect(first.body.error).toBe('authorization_pending');
	});

	test('polling faster than the interval earns slow_down, and widens it', async () => {
		const grant = await started();
		await poll(grant.device_code);

		const tooSoon = await poll(grant.device_code);
		expect(tooSoon.body.error).toBe('slow_down');

		// The interval the client is told to use grows, per RFC 8628 §3.5, so
		// a client that ignores the first warning is not merely told again.
		setSystemTime(new Date(Date.now() + (grant.interval + 1) * 1000));
		const stillTooSoon = await poll(grant.device_code);
		expect(stillTooSoon.body.error).toBe('slow_down');

		setSystemTime(new Date(Date.now() + (grant.interval + 6) * 1000));
		const patient = await poll(grant.device_code);
		expect(patient.body.error).toBe('authorization_pending');
	});

	test('an unknown device code is not treated as pending', async () => {
		const response = await poll('not-a-device-code');
		expect(response.status).toBe(400);
		expect(response.body.error).toBe('expired_token');
	});

	test('an expired code says so instead of pending forever', async () => {
		const grant = await started();
		setSystemTime(new Date(Date.now() + (grant.expires_in + 60) * 1000));
		const response = await poll(grant.device_code);
		expect(response.body.error).toBe('expired_token');
	});

	test('a code belongs to the client that asked for it', async () => {
		const grant = await started();
		const response = await poll(grant.device_code, 'somebody-else');
		expect(response.status).toBe(400);
		expect(response.body.error).toBe('invalid_grant');
	});

	test('a poll with no client_id is not a poll', async () => {
		const grant = await started();
		const response = await auth.request(`${ORIGIN}/token`, {
			method: 'POST',
			headers: { 'content-type': 'application/x-www-form-urlencoded' },
			body: new URLSearchParams({
				grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
				device_code: grant.device_code
			})
		});
		expect(response.status).toBe(400);
		expect(((await response.json()) as any).error).toBe('invalid_request');
	});
});

describe('approval', () => {
	test('approving hands the next poll a token', async () => {
		const grant = await started();
		const confirmed = await answer(grant.user_code, 'approve');
		expect(confirmed.status).toBe(200);

		setSystemTime(new Date(Date.now() + (grant.interval + 1) * 1000));
		const response = await poll(grant.device_code);
		expect(response.status).toBe(200);
		expect(response.body.access_token).toMatch(/.+/);
		expect(response.body.refresh_token).toMatch(/.+/);
	});

	test('a device code is redeemable once', async () => {
		const grant = await started();
		await answer(grant.user_code, 'approve');

		setSystemTime(new Date(Date.now() + (grant.interval + 1) * 1000));
		expect((await poll(grant.device_code)).status).toBe(200);
		setSystemTime(new Date(Date.now() + (grant.interval + 1) * 1000));
		expect((await poll(grant.device_code)).body.error).toBe('expired_token');
	});

	test('the user code is accepted in the form a person reads aloud', async () => {
		const grant = await started();
		const chunked = `${grant.user_code.slice(0, 4)}-${grant.user_code.slice(4)}`;
		await answer(chunked.toLowerCase(), 'approve');

		setSystemTime(new Date(Date.now() + (grant.interval + 1) * 1000));
		expect((await poll(grant.device_code)).status).toBe(200);
	});

	test('an unknown user code does not start a provider flow', async () => {
		// Its own address, so the budget it spends is its own — the shared
		// bucket for callers with no address is asserted on further down.
		const response = await auth.request(`${ORIGIN}/device?user_code=ZZZZZZZZ`, {
			headers: { 'cf-connecting-ip': '198.51.100.9' }
		});
		expect(response.status).toBe(400);
	});

	test('a refusal is final, and says so', async () => {
		const grant = await started();
		const denied = await answer(grant.user_code, 'deny');
		expect(denied.status).toBe(200);

		const response = await poll(grant.device_code);
		expect(response.body.error).toBe('access_denied');
	});
});

/**
 * The attack this flow exists to stop, and the properties that stop it.
 *
 * Anyone can ask for a device code and be handed a link with the user code
 * already in it. Send that link to somebody, keep the device code, and if
 * their signing in were enough you would be holding their tokens. It is not
 * enough, and these say why.
 */
describe('a code somebody else started', () => {
	test('following the link and signing in approves nothing', async () => {
		const grant = await started();

		const reached = await signInAndReachConfirmation(grant.user_code);
		expect(reached.status).toBe(200);

		// The victim has signed in. The attacker polls. There is still no
		// answer, because being signed in is not the same as having agreed.
		const response = await poll(grant.device_code);
		expect(response.status).toBe(400);
		expect(response.body.error).toBe('authorization_pending');
	});

	test('the page shows the code, so it can be compared with the device', async () => {
		const grant = await started();
		const reached = await signInAndReachConfirmation(grant.user_code);

		expect(reached.html).toContain(grant.user_code.slice(0, 4));
		expect(reached.html).toContain(grant.user_code.slice(4));
		expect(reached.html).toContain('desktop');
	});

	test('a confirmation posted without the value from the cookie is refused', async () => {
		const grant = await started();
		const { cookies } = await signInAndReachConfirmation(grant.user_code);

		const forged = await auth.request(`${ORIGIN}/device/confirm`, {
			method: 'POST',
			headers: { cookie: cookies.header(), 'content-type': 'application/x-www-form-urlencoded' },
			body: new URLSearchParams({ csrf: 'guessed', action: 'approve' })
		});
		expect(forged.status).toBe(400);
		expect((await poll(grant.device_code)).body.error).toBe('authorization_pending');
	});

	test('confirming with no cookie at all authorizes nothing', async () => {
		const grant = await started();
		await signInAndReachConfirmation(grant.user_code);

		const bare = await auth.request(`${ORIGIN}/device/confirm`, {
			method: 'POST',
			headers: { 'content-type': 'application/x-www-form-urlencoded' },
			body: new URLSearchParams({ csrf: 'anything', action: 'approve' })
		});
		expect(bare.status).toBe(400);
		expect((await poll(grant.device_code)).body.error).toBe('authorization_pending');
	});
});

/**
 * Two things touching one grant at the same time.
 *
 * The browser and the polling client are always racing; the question is only
 * whether the loser can undo the winner. Held here against the in-memory
 * store, whose methods do not suspend part way through — a store that talks to
 * a database has to give the same guarantees for itself.
 */
describe('when both halves move at once', () => {
	test('a poll cannot undo an approval that landed while it was in flight', async () => {
		const grant = await started();
		const hash = await hashDeviceCode(grant.device_code);

		// A poll reads a pending grant, the browser approves, and then the
		// poll writes its bookkeeping. What it writes must not include the
		// status it read.
		const stale = await deviceStore.byDeviceCode(hash);
		expect(stale!.status).toBe('pending');
		await answer(grant.user_code, 'approve');
		await deviceStore.recordPoll(hash, Date.now(), stale!.interval);

		expect((await deviceStore.byDeviceCode(hash))!.status).toBe('approved');
		setSystemTime(new Date(Date.now() + (grant.interval + 1) * 1000));
		expect((await poll(grant.device_code)).status).toBe(200);
	});

	test('an approval cannot overwrite a refusal that got there first', async () => {
		const grant = await started();
		const hash = await hashDeviceCode(grant.device_code);

		// Both halves reach the question; one presses Deny and one presses
		// Approve. Whichever arrives second is answering something that has
		// already been answered.
		const first = await signInAndReachConfirmation(grant.user_code);
		const second = await signInAndReachConfirmation(grant.user_code);
		const csrfOf = (html: string) => /name="csrf" value="([^"]+)"/.exec(html)![1]!;

		const denied = await auth.request(`${ORIGIN}/device/confirm`, {
			method: 'POST',
			headers: {
				cookie: first.cookies.header(),
				'content-type': 'application/x-www-form-urlencoded'
			},
			body: new URLSearchParams({ csrf: csrfOf(first.html), action: 'deny' })
		});
		expect(denied.status).toBe(200);

		const late = await auth.request(`${ORIGIN}/device/confirm`, {
			method: 'POST',
			headers: {
				cookie: second.cookies.header(),
				'content-type': 'application/x-www-form-urlencoded'
			},
			body: new URLSearchParams({ csrf: csrfOf(second.html), action: 'approve' })
		});
		expect(late.status).toBe(400);

		expect((await deviceStore.byDeviceCode(hash))!.status).toBe('denied');
		expect((await poll(grant.device_code)).body.error).toBe('access_denied');
	});

	test('two polls racing one approved grant serve one of them', async () => {
		const grant = await started();
		await answer(grant.user_code, 'approve');
		const hash = await hashDeviceCode(grant.device_code);

		const [a, b] = await Promise.all([
			deviceStore.consume(hash, 'desktop'),
			deviceStore.consume(hash, 'desktop')
		]);
		expect([a, b].filter(Boolean)).toHaveLength(1);
	});
});

/**
 * Working through the code space, and what stops it.
 *
 * A user code is eight characters from an alphabet of twenty-five, so guessing
 * one is not cheap — but it is a fixed cost, and the endpoint that checks them
 * had no opinion about how often you asked. RFC 8628 §5.2 asks for one.
 */
describe('guessing at user codes', () => {
	/** A caller with an address of its own, so budgets do not run together. */
	function from(address: string) {
		return (userCode: string) =>
			auth.request(`${ORIGIN}/device?user_code=${encodeURIComponent(userCode)}`, {
				headers: { 'cf-connecting-ip': address }
			});
	}

	test('a caller runs out of tries', async () => {
		const tries = from('198.51.100.1');

		expect((await tries('ZZZZZZZZ')).status).toBe(400);
		expect((await tries('ZZZZZZZY')).status).toBe(400);
		expect((await tries('ZZZZZZZX')).status).toBe(400);
		expect((await tries('ZZZZZZZW')).status).toBe(429);
	});

	test('one caller running out does not lock out another', async () => {
		const noisy = from('198.51.100.2');
		for (let i = 0; i < 4; i++) await noisy(`ZZZZZZZ${'ABCD'[i]}`);
		expect((await noisy('ZZZZZZZZ')).status).toBe(429);

		const grant = await started();
		const quiet = await auth.request(
			`${ORIGIN}/device?user_code=${encodeURIComponent(grant.user_code)}`,
			{ headers: { 'cf-connecting-ip': '198.51.100.3' } }
		);
		expect(quiet.status).toBe(302);
	});

	test('getting one right is not charged for', async () => {
		const address = '198.51.100.4';
		const tries = from(address);
		expect((await tries('ZZZZZZZZ')).status).toBe(400);
		expect((await tries('ZZZZZZZY')).status).toBe(400);

		// Two wrong out of a budget of three. A correct code in between must
		// not be what tips the next wrong one over.
		const grant = await started();
		const right = await auth.request(
			`${ORIGIN}/device?user_code=${encodeURIComponent(grant.user_code)}`,
			{ headers: { 'cf-connecting-ip': address } }
		);
		expect(right.status).toBe(302);

		expect((await tries('ZZZZZZZX')).status).toBe(400);
		expect((await tries('ZZZZZZZW')).status).toBe(429);
	});

	// A caller who strips the headers that say where they are lands in one
	// shared bucket. That is deliberate: it makes hiding cost a smaller budget
	// rather than buying an unlimited one.
	test('a caller with no address still has a budget', async () => {
		for (let i = 0; i < 3; i++) {
			expect((await auth.request(`${ORIGIN}/device?user_code=ZZZZZZZ${'ABC'[i]}`)).status).toBe(
				400
			);
		}
		expect((await auth.request(`${ORIGIN}/device?user_code=ZZZZZZZD`)).status).toBe(429);
	});
});
