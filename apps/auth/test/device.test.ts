import { afterEach, beforeEach, describe, expect, setSystemTime, test } from 'bun:test';

import { issuer } from '@nestri/auth/index';
import { MemoryStorage } from '@nestri/auth/storage/memory';
import { subjects } from '@nestri/core/auth/subjects';

import { allowDeviceClient, clientTTL } from '../src/index.js';

/**
 * The issuer the worker builds, with the database taken out and the real rules
 * about device clients left in.
 *
 * The provider is a stub that signs straight in, because what is under test is
 * what happens around the sign-in: which programs may start a grant, how long
 * the session each is handed lasts, and what the person is asked.
 */
const auth = issuer({
	subjects,
	storage: MemoryStorage(),
	allow: async () => true,
	allowDeviceClient,
	clientTTL,
	providers: {
		stub: {
			type: 'stub',
			init(route, ctx) {
				route.get('/authorize', (c) => ctx.success(c, {}));
			}
		}
	},
	async success(context) {
		return context.subject('user', { userID: 'usr_test123', linkedAccountID: '' });
	}
});

const ORIGIN = 'https://auth.internal';

/** The claims, unverified: the issuer that signed them is right here. */
function claims(token: string) {
	return JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString()) as { aud: string };
}

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

function form(body: Record<string, string>) {
	return {
		method: 'POST',
		headers: { 'content-type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams(body)
	};
}

async function begin(clientID: string) {
	return auth.request(`${ORIGIN}/device/authorize`, form({ client_id: clientID }));
}

/** Start a grant and sign in, stopping at the question the person is asked. */
async function reachConfirmation(clientID: string) {
	const started = (await (await begin(clientID)).json()) as any;
	const cookies = jar();
	const entered = await auth.request(`${ORIGIN}/device?user_code=${started.user_code}`);
	cookies.absorb(entered);
	const asked = await auth.request(new URL(entered.headers.get('location')!, ORIGIN).toString(), {
		headers: { cookie: cookies.header() }
	});
	cookies.absorb(asked);
	return { started, cookies, html: await asked.text() };
}

/** The whole grant, approved, ending in what the program is handed. */
async function approved(clientID: string) {
	const { started, cookies, html } = await reachConfirmation(clientID);
	const csrf = /name="csrf" value="([^"]+)"/.exec(html)![1]!;
	await auth.request(`${ORIGIN}/device/confirm`, {
		...form({ csrf, action: 'approve' }),
		headers: {
			cookie: cookies.header(),
			'content-type': 'application/x-www-form-urlencoded'
		}
	});
	setSystemTime(new Date(Date.now() + (started.interval + 1) * 1000));
	const response = await auth.request(
		`${ORIGIN}/token`,
		form({
			grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
			device_code: started.device_code,
			client_id: clientID
		})
	);
	expect(response.status).toBe(200);
	return (await response.json()) as any;
}

beforeEach(() => setSystemTime(new Date('2026-01-01T00:00:00Z')));
afterEach(() => setSystemTime());

describe('device clients', () => {
	test('only the programs this issuer knows may start a grant', async () => {
		expect((await begin('desktop')).status).toBe(200);
		expect((await begin('installer')).status).toBe(200);
		expect((await begin('something-else')).status).toBe(400);
	});

	test('the installer gets a quarter of an hour and no refresh token', async () => {
		const tokens = await approved('installer');
		expect(tokens.expires_in).toBe(15 * 60);
		expect(claims(tokens.access_token).aud).toBe('installer');
		expect(tokens).not.toHaveProperty('refresh_token');
	});

	test('the desktop app keeps a session it can refresh', async () => {
		const tokens = await approved('desktop');
		expect(tokens.expires_in).toBe(60 * 60 * 24 * 30);
		expect(claims(tokens.access_token).aud).toBe('desktop');
		expect(tokens.refresh_token).toMatch(/.+/);
	});
});
