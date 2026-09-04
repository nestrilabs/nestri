import { afterEach, beforeEach, describe, expect, setSystemTime, test } from 'bun:test';

import { object, string } from 'valibot';

import { issuer } from '../src/issuer.js';
import { MemoryStorage } from '../src/storage/memory.js';
import { createSubjects } from '../src/subject.js';

const subjects = createSubjects({
	user: object({
		userID: string()
	})
});

const auth = issuer({
	storage: MemoryStorage(),
	subjects,
	allow: async () => true,
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

async function begin() {
	const response = await auth.request(`${ORIGIN}/device/authorize`, {
		method: 'POST',
		headers: { 'content-type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({ client_id: 'desktop' })
	});
	expect(response.status).toBe(200);
	return response.json() as Promise<{
		device_code: string;
		user_code: string;
		verification_uri: string;
		verification_uri_complete: string;
		expires_in: number;
		interval: number;
	}>;
}

async function poll(deviceCode: string) {
	const response = await auth.request(`${ORIGIN}/token`, {
		method: 'POST',
		headers: { 'content-type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({
			grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
			device_code: deviceCode,
			client_id: 'desktop'
		})
	});
	return { status: response.status, body: (await response.json()) as any };
}

/** Walk the browser half: enter the code, then finish the provider flow. */
async function approve(userCode: string) {
	const entered = await auth.request(`${ORIGIN}/device?user_code=${encodeURIComponent(userCode)}`);
	expect(entered.status).toBe(302);
	const cookie = entered.headers.get('set-cookie')!;
	expect(cookie).toBeTruthy();
	const done = await auth.request(new URL(entered.headers.get('location')!, ORIGIN).toString(), {
		headers: { cookie }
	});
	expect(done.status).toBe(200);
	return done;
}

beforeEach(() => setSystemTime(new Date('2026-01-01T00:00:00Z')));
afterEach(() => setSystemTime());

describe('device authorization request', () => {
	test('answers with everything the polling client needs', async () => {
		const started = await begin();

		expect(started.device_code).toMatch(/.+/);
		// Eight characters, so the client's four-and-four chunking reads
		// evenly when a person says it out loud.
		expect(started.user_code).toMatch(/^[A-Z0-9]{8}$/);
		expect(started.verification_uri).toBe(`${ORIGIN}/device`);
		expect(started.verification_uri_complete).toContain(started.user_code);
		expect(started.interval).toBeGreaterThanOrEqual(1);
		expect(started.expires_in).toBeGreaterThan(started.interval);
	});

	test('two requests do not collide', async () => {
		const a = await begin();
		const b = await begin();
		expect(a.device_code).not.toBe(b.device_code);
		expect(a.user_code).not.toBe(b.user_code);
	});

	test('the metadata document advertises the endpoint and the grant', async () => {
		const response = await auth.request(`${ORIGIN}/.well-known/oauth-authorization-server`);
		const body: any = await response.json();
		expect(body.device_authorization_endpoint).toBe(`${ORIGIN}/device/authorize`);
		expect(body.grant_types_supported).toContain('urn:ietf:params:oauth:grant-type:device_code');
	});
});

describe('polling', () => {
	test('an unapproved code is pending', async () => {
		const started = await begin();
		const first = await poll(started.device_code);
		expect(first.status).toBe(400);
		expect(first.body.error).toBe('authorization_pending');
	});

	test('polling faster than the interval earns slow_down, and widens it', async () => {
		const started = await begin();
		await poll(started.device_code);

		const tooSoon = await poll(started.device_code);
		expect(tooSoon.body.error).toBe('slow_down');

		// The interval the client is told to use grows, per RFC 8628 §3.5, so
		// a client that ignores the first warning is not merely told again.
		setSystemTime(new Date(Date.now() + (started.interval + 1) * 1000));
		const stillTooSoon = await poll(started.device_code);
		expect(stillTooSoon.body.error).toBe('slow_down');

		setSystemTime(new Date(Date.now() + (started.interval + 6) * 1000));
		const patient = await poll(started.device_code);
		expect(patient.body.error).toBe('authorization_pending');
	});

	test('an unknown device code is not treated as pending', async () => {
		const answer = await poll('not-a-device-code');
		expect(answer.status).toBe(400);
		expect(answer.body.error).toBe('expired_token');
	});

	test('an expired code says so instead of pending forever', async () => {
		const started = await begin();
		setSystemTime(new Date(Date.now() + (started.expires_in + 60) * 1000));
		const answer = await poll(started.device_code);
		expect(answer.body.error).toBe('expired_token');
	});
});

describe('approval', () => {
	test('approving hands the next poll a token', async () => {
		const started = await begin();
		await approve(started.user_code);

		setSystemTime(new Date(Date.now() + (started.interval + 1) * 1000));
		const answer = await poll(started.device_code);
		expect(answer.status).toBe(200);
		expect(answer.body.access_token).toMatch(/.+/);
		expect(answer.body.refresh_token).toMatch(/.+/);
	});

	test('a device code is redeemable once', async () => {
		const started = await begin();
		await approve(started.user_code);

		setSystemTime(new Date(Date.now() + (started.interval + 1) * 1000));
		expect((await poll(started.device_code)).status).toBe(200);
		setSystemTime(new Date(Date.now() + (started.interval + 1) * 1000));
		expect((await poll(started.device_code)).body.error).toBe('expired_token');
	});

	test('the user code is accepted in the form a person reads aloud', async () => {
		const started = await begin();
		const chunked = `${started.user_code.slice(0, 4)}-${started.user_code.slice(4)}`;
		await approve(chunked.toLowerCase());

		setSystemTime(new Date(Date.now() + (started.interval + 1) * 1000));
		expect((await poll(started.device_code)).status).toBe(200);
	});

	test('an unknown user code does not start a provider flow', async () => {
		const response = await auth.request(`${ORIGIN}/device?user_code=ZZZZZZZZ`);
		expect(response.status).toBe(400);
	});

	test('a refusal is final, and says so', async () => {
		const started = await begin();
		const denied = await auth.request(
			`${ORIGIN}/device/deny?user_code=${encodeURIComponent(started.user_code)}`
		);
		expect(denied.status).toBe(200);

		const answer = await poll(started.device_code);
		expect(answer.body.error).toBe('access_denied');
	});
});
