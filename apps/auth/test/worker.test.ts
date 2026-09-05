import { describe, expect, test } from 'bun:test';

import { createClient } from '@nestri/auth/client';
import { issuer } from '@nestri/auth/index';
import { CodeProvider } from '@nestri/auth/provider/code';
import { MemoryStorage } from '@nestri/auth/storage/memory';
import { CodeUI } from '@nestri/auth/ui/code';
import { subjects } from '@nestri/core/auth/subjects';

/**
 * The issuer the worker builds, with the database taken out.
 *
 * The provider list is the load-bearing part and is the same one
 * `apps/auth/src/index.ts` passes: one entry, `code`. `success` is a stub
 * because what the real one does — resolve an address to a user and give it a
 * team — is core's behaviour and is held by core's own tests. What this file
 * holds is the shape of the issuer around it.
 */
let lastCode = '';
const storage = MemoryStorage();
const auth = issuer({
	subjects,
	storage,
	allow: async () => true,
	providers: {
		code: CodeProvider({
			...CodeUI({ copy: { code_info: 'test' }, sendCode: async () => {} }),
			sendCode: async (_claims, code) => {
				lastCode = code;
			}
		})
	},
	async success(context, response) {
		if (response.provider === 'code') {
			return context.subject('user', {
				userID: 'usr_test123',
				linkedAccountID: ''
			});
		}
		throw new Error('Unknown provider');
	}
});

/**
 * Signing in with a gaming account or a key is gone, and this is the assertion
 * that keeps it gone.
 *
 * Both used to be providers here and both could bring a user into existence
 * from something that is not an address, which is the shape the account model
 * no longer has. The provider implementations still exist and can be wired
 * back; what must not happen quietly is them becoming reachable again.
 */
describe('what the issuer serves', () => {
	test('there is no sign-in with a gaming account', async () => {
		const response = await auth.request('https://auth.internal/steam/authorize');
		expect(response.status).toBe(404);
	});

	test('there is no sign-in with a key', async () => {
		const response = await auth.request('https://auth.internal/ssh/login', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ fingerprint: 'SHA256:abc123', steamId: '76561198012345678' })
		});
		expect(response.status).toBe(404);
	});

	test('asking for a code is where a sign-in starts', async () => {
		const response = await auth.request('https://auth.internal/code/authorize');
		expect(response.status).toBe(200);
	});
});

/**
 * A cookie jar, because this flow needs two cookies at once.
 *
 * `/authorize` sets the one holding the authorization, the code provider sets
 * the one holding its own state, and both have to be presented at the verify
 * step. `Headers.get('set-cookie')` returns only the first of several, which
 * silently drops one of them.
 */
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

/** Ask for a code, redeem it, and come back holding tokens. */
async function signIn() {
	const client = createClient({
		issuer: 'https://auth.internal',
		clientID: 'api',
		fetch: (input: any, init: any) => Promise.resolve(auth.request(input, init))
	});

	const { challenge, url } = await client.authorize('https://client.example.com/callback', 'code', {
		pkce: true,
		provider: 'code'
	});

	const cookies = jar();
	cookies.absorb(await auth.request(url));
	expect(cookies.header()).not.toBe('');

	const requested = await auth.request('https://auth.internal/code/authorize', {
		method: 'POST',
		headers: { cookie: cookies.header(), 'content-type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({ action: 'request', email: 'ada@example.com' })
	});
	cookies.absorb(requested);
	expect(lastCode).not.toBe('');

	const verified = await auth.request('https://auth.internal/code/authorize', {
		method: 'POST',
		headers: { cookie: cookies.header(), 'content-type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({ action: 'verify', code: lastCode })
	});
	expect(verified.status).toBe(302);

	const location = new URL(verified.headers.get('location')!);
	const code = location.searchParams.get('code');
	expect(code).not.toBeNull();

	const exchanged = await client.exchange(
		code!,
		'https://client.example.com/callback',
		challenge.verifier
	);
	if (exchanged.err) throw exchanged.err;
	return { client, tokens: exchanged.tokens! };
}

describe('signing in with an email address', () => {
	test('a redeemed code becomes tokens that verify', async () => {
		const { client, tokens } = await signIn();

		expect(tokens.access).toBeString();
		expect(tokens.refresh).toBeString();

		const verified = await client.verify(subjects, tokens.access);
		if (verified.err) throw verified.err;
		expect(verified.subject).toEqual({
			type: 'user',
			properties: {
				userID: 'usr_test123',
				linkedAccountID: ''
			}
		});
	});
});

describe('User info', () => {
	test('returns subject properties for valid access token', async () => {
		const { tokens } = await signIn();

		const infoRes = await auth.request('https://auth.internal/userinfo', {
			headers: { Authorization: `Bearer ${tokens.access}` }
		});

		expect(infoRes.status).toBe(200);
		const userinfo = await infoRes.json();
		expect(userinfo).toMatchObject({
			userID: 'usr_test123',
			linkedAccountID: ''
		});
	});
});
