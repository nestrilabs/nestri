import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

import { createClient } from '@nestri/auth/client';
import { issuer } from '@nestri/auth/index';
import { SshProvider } from '@nestri/auth/provider/ssh';
import { SteamProvider } from '@nestri/auth/provider/steam';
import { MemoryStorage } from '@nestri/auth/storage/memory';
import { subjects } from '@nestri/core/auth/subjects';

const storage = MemoryStorage();

const auth = issuer({
	subjects,
	storage,
	allow: async () => true,
	providers: {
		steam: SteamProvider(),
		ssh: SshProvider({ sshAuthKey: 'test-ssh-key' })
	},
	async success(context, response) {
		if (response.provider === 'steam') {
			return context.subject('user', {
				userID: 'usr_test123',
				linkedAccountID: 'lac_test456'
			});
		}
		if (response.provider === 'ssh') {
			return context.subject('user', {
				userID: 'usr_test123',
				linkedAccountID: 'lac_test456',
				fingerprint: response.fingerprint
			});
		}
		throw new Error('unknown provider');
	}
});

beforeEach(() => {
	globalThis.fetch = mock(async (input: string | URL | Request, _init?: RequestInit) => {
		const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

		if (url.includes('steamcommunity.com/openid/login')) {
			return new Response('ns:http://specs.openid.net/auth/2.0\nis_valid:true\n', { status: 200 });
		}

		if (url.includes('api.steampowered.com')) {
			return new Response(
				JSON.stringify({
					response: {
						players: [
							{
								personaname: 'TestPlayer',
								avatarfull:
									'https://steamcdn-a.akamaihd.net/steamcommunity/public/images/avatars/fe/fef49e7fa7e1997310d705b2a6158ff8dc1cdfeb.jpg',
								steamid: '76561197960287956'
							}
						]
					}
				}),
				{ status: 200 }
			);
		}

		return new Response('not found', { status: 404 });
	}) as unknown as typeof fetch;
});

afterEach(() => {
	globalThis.fetch = fetch;
});

describe('Steam auth flow', () => {
	test('authorize redirects to Steam OpenID', async () => {
		const response = await auth.request('https://auth.internal/steam/authorize');
		expect(response.status).toBe(302);
		expect(response.headers.get('location')).toMatch(/steamcommunity\.com\/openid/);
	});

	test('full code flow and token verification', async () => {
		const client = createClient({
			issuer: 'https://auth.internal',
			clientID: 'api',
			fetch: (input: any, init: any) => Promise.resolve(auth.request(input, init))
		});

		const { challenge, url } = await client.authorize(
			'https://client.example.com/callback',
			'code',
			{ pkce: true, provider: 'steam' }
		);

		// Step 1: hit the authorize URL → redirects to Steam OpenID
		const authResponse = await auth.request(url);
		expect(authResponse.status).toBe(302);
		const cookie = authResponse.headers.get('set-cookie')!;
		expect(cookie).toBeDefined();

		// Step 2: simulate Steam redirecting back to our callback with valid OpenID params
		const callbackUrl =
			'https://auth.internal/steam/callback?' +
			'openid.ns=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0&' +
			'openid.mode=id_res&' +
			'openid.return_to=https%3A%2F%2Fauth.internal%2Fsteam%2Fcallback&' +
			'openid.claimed_id=https%3A%2F%2Fsteamcommunity.com%2Fopenid%2Fid%2F76561197960287956&' +
			'openid.identity=https%3A%2F%2Fsteamcommunity.com%2Fopenid%2Fid%2F76561197960287956';

		const callbackResponse = await auth.request(callbackUrl, {
			headers: { cookie }
		});
		expect(callbackResponse.status).toBe(302);

		const location = new URL(callbackResponse.headers.get('location')!);
		const code = location.searchParams.get('code');
		expect(code).not.toBeNull();

		const exchanged = await client.exchange(
			code!,
			'https://client.example.com/callback',
			challenge.verifier
		);
		if (exchanged.err) throw exchanged.err;
		const tokens = exchanged.tokens!;

		expect(tokens.access).toBeString();
		expect(tokens.refresh).toBeString();

		const verified = await client.verify(subjects, tokens.access);
		if (verified.err) throw verified.err;
		expect(verified.subject).toEqual({
			type: 'user',
			properties: {
				userID: 'usr_test123',
				linkedAccountID: 'lac_test456'
			}
		});
	});
});

describe('SSH login', () => {
	test('valid login returns tokens', async () => {
		const loginResponse = await auth.request('https://auth.internal/ssh/login', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: 'Bearer test-ssh-key'
			},
			body: JSON.stringify({
				fingerprint: 'SHA256:abc123',
				steamId: '76561198012345678'
			})
		});

		expect(loginResponse.status).toBe(200);
		const body: any = await loginResponse.json();
		expect(body.accessToken).toBeString();
		expect(body.refreshToken).toBeString();
	});

	test('invalid auth key returns 401', async () => {
		const response = await auth.request('https://auth.internal/ssh/login', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: 'Bearer wrong-key'
			},
			body: JSON.stringify({
				fingerprint: 'SHA256:abc123',
				steamId: '76561198012345678'
			})
		});

		expect(response.status).toBe(401);
	});
});

describe('User info', () => {
	async function getTokens() {
		const client = createClient({
			issuer: 'https://auth.internal',
			clientID: 'api',
			fetch: (input: any, init: any) => Promise.resolve(auth.request(input, init))
		});

		const { challenge, url } = await client.authorize(
			'https://client.example.com/callback',
			'code',
			{ pkce: true, provider: 'steam' }
		);

		const authResponse = await auth.request(url);
		const cookie = authResponse.headers.get('set-cookie')!;

		const callbackUrl =
			'https://auth.internal/steam/callback?' +
			'openid.ns=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0&' +
			'openid.mode=id_res&' +
			'openid.return_to=https%3A%2F%2Fauth.internal%2Fsteam%2Fcallback&' +
			'openid.claimed_id=https%3A%2F%2Fsteamcommunity.com%2Fopenid%2Fid%2F76561197960287956&' +
			'openid.identity=https%3A%2F%2Fsteamcommunity.com%2Fopenid%2Fid%2F76561197960287956';

		const callbackResponse = await auth.request(callbackUrl, { headers: { cookie } });
		const location = new URL(callbackResponse.headers.get('location')!);
		const code = location.searchParams.get('code');
		const exchanged = await client.exchange(
			code!,
			'https://client.example.com/callback',
			challenge.verifier
		);
		if (exchanged.err) throw exchanged.err;
		return { client, tokens: exchanged.tokens! };
	}

	test('returns subject properties for valid access token', async () => {
		const { tokens } = await getTokens();

		const infoRes = await auth.request('https://auth.internal/userinfo', {
			headers: { Authorization: `Bearer ${tokens.access}` }
		});

		expect(infoRes.status).toBe(200);
		const userinfo = await infoRes.json();
		expect(userinfo).toMatchObject({
			userID: 'usr_test123',
			linkedAccountID: 'lac_test456'
		});
	});
});
