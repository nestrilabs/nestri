import { describe, expect, test } from 'bun:test';

import { issuer } from '@nestri/auth/index';
import { CodeProvider } from '@nestri/auth/provider/code';
import { MemoryStorage } from '@nestri/auth/storage/memory';
import { CodeUI } from '@nestri/auth/ui/code';
import { subjects } from '@nestri/core/auth/subjects';

import { allowClient } from '../src/index.js';

/**
 * The same issuer the worker builds, with the database taken out and the real
 * rule about which clients may start a flow left in.
 *
 * `allow` is the whole subject of this file, so unlike `worker.test.ts` it is
 * not stubbed to `true`.
 */
const auth = issuer({
	subjects,
	storage: MemoryStorage(),
	allow: allowClient,
	providers: {
		code: CodeProvider({
			...CodeUI({ copy: { code_info: 'test' }, sendCode: async () => {} }),
			sendCode: async () => {}
		})
	},
	async success(context) {
		return context.subject('user', { userID: 'usr_test123', linkedAccountID: '' });
	}
});

/**
 * Start an authorization and say only whether the client was allowed.
 *
 * An allowed client is redirected on towards the provider; a refused one is
 * answered by the issuer itself. The distinction is the status, and nothing
 * below cares about anything past it.
 */
async function allowed(clientID: string, redirectURI: string): Promise<boolean> {
	const url = new URL('https://auth.internal/authorize');
	url.searchParams.set('client_id', clientID);
	url.searchParams.set('redirect_uri', redirectURI);
	url.searchParams.set('response_type', 'code');
	const response = await auth.request(url.toString());
	if (response.status !== 302) {
		return false;
	}
	// An allowed client is sent on to the provider, which is a path on this
	// issuer. Anywhere else is not a sign-in beginning.
	return (response.headers.get('location') ?? '').startsWith('/');
}

/**
 * A browser that reaches one of these hostnames is standing on a different
 * registrable domain from this issuer, and a session set here can never be
 * sent there — a `__Host-` cookie has no `Domain` attribute and is host-only,
 * which is exactly what it is for. The proxy in front of those hosts closes
 * that by being an ordinary client and exchanging a code for a session it sets
 * on the hostname the browser is actually on.
 *
 * Before this rule existed every case below was refused, including the first.
 */
describe('a host may receive a code at its own name', () => {
	test('the reserved callback on the client id itself is allowed', async () => {
		expect(await allowed('m123.nestri.link', 'https://m123.nestri.link/__nestri/callback')).toBe(
			true
		);
	});

	test('a code is never sent anywhere but the client id', async () => {
		// The attack this refuses: a client that names itself as one host and
		// asks for the code at another.
		expect(await allowed('m123.nestri.link', 'https://evil.nestri.link/__nestri/callback')).toBe(
			false
		);
		expect(await allowed('m123.nestri.link', 'https://evil.example/__nestri/callback')).toBe(false);
	});

	test('only the reserved path receives a code', async () => {
		// Anything else under the hostname is served by the host itself, and a
		// return address a caller chooses is an open redirector on every
		// hostname in the zone.
		expect(await allowed('m123.nestri.link', 'https://m123.nestri.link/')).toBe(false);
		expect(
			await allowed('m123.nestri.link', 'https://m123.nestri.link/__nestri/callback/../..')
		).toBe(false);
		expect(
			await allowed('m123.nestri.link', 'https://m123.nestri.link/__nestri/callback?next=x')
		).toBe(false);
	});

	test('a code goes over https or it does not go', async () => {
		expect(await allowed('m123.nestri.link', 'http://m123.nestri.link/__nestri/callback')).toBe(
			false
		);
	});

	test('one label, because a deeper name is not a host id', async () => {
		// `a.b.zone` must not be treated as a host id just because `b.zone`
		// might be one.
		expect(
			await allowed('a.m123.nestri.link', 'https://a.m123.nestri.link/__nestri/callback')
		).toBe(false);
		expect(await allowed('nestri.link', 'https://nestri.link/__nestri/callback')).toBe(false);
	});

	test('another zone does not get in by using the path', async () => {
		expect(await allowed('m123.example.com', 'https://m123.example.com/__nestri/callback')).toBe(
			false
		);
	});
});

describe('everything else keeps the rule it had', () => {
	test('a redirect back to where the request arrived is still allowed', async () => {
		expect(await allowed('web', 'https://auth.internal/callback')).toBe(true);
	});

	test('local development is still allowed', async () => {
		expect(await allowed('web', 'http://localhost:5173/callback')).toBe(true);
	});

	test('an unrelated domain is still refused', async () => {
		expect(await allowed('web', 'https://somewhere.example/callback')).toBe(false);
	});
});

/**
 * A refusal is delivered here, not wherever the refused client asked.
 *
 * The issuer reports an error by redirecting to the caller's `redirect_uri`,
 * which is right once that URI has been approved. This is the case where it has
 * just been rejected — and honouring it there made `/authorize` an open
 * redirector to anywhere at all, reachable without signing in, on the hostname
 * people are asked to type a password into.
 */
describe('a refused client does not choose where the refusal goes', () => {
	test('the refusal is a page here, not a redirect to the caller', async () => {
		const url = new URL('https://auth.internal/authorize');
		url.searchParams.set('client_id', 'web');
		url.searchParams.set('redirect_uri', 'https://somewhere.example/callback');
		url.searchParams.set('response_type', 'code');

		const response = await auth.request(url.toString());

		expect(response.status).toBe(400);
		expect(response.headers.get('location')).toBeNull();
	});
});
