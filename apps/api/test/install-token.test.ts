import { afterAll, beforeEach, describe, expect, test } from 'bun:test';

import { Fixtures } from '@nestri/core/db/fixtures';
import { testDb } from '@nestri/core/db/test';
import { Env } from '@nestri/core/env';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';

import { app } from '../app/index';
import { TEST_FRONTEND_URL } from './setup';

const sql = testDb();
const createdUserIds: string[] = [];

afterAll(async () => {
	if (createdUserIds.length > 0) {
		await sql`delete from machine where owner_user_id in ${sql(createdUserIds)}`;
		await sql`delete from "user" where id in ${sql(createdUserIds)}`;
	}
});

/**
 * An issuer, reached the way the API reaches one in production: through a
 * binding that serves its discovery document and its keys. Tokens are signed
 * here with the claims the real issuer writes, `aud` being the client id.
 */
const ISSUER = 'https://auth.test';
const keys = await generateKeyPair('ES256');
const jwk = { ...(await exportJWK(keys.publicKey)), kid: 'test', alg: 'ES256', use: 'sig' };
const env = {
	AUTH: {
		fetch: async (request: Request) => {
			const { pathname } = new URL(request.url);
			if (pathname === '/.well-known/oauth-authorization-server') {
				return Response.json({ issuer: ISSUER, jwks_uri: `${ISSUER}/.well-known/jwks.json` });
			}
			if (pathname === '/.well-known/jwks.json') return Response.json({ keys: [jwk] });
			return new Response('not found', { status: 404 });
		}
	}
};

beforeEach(() => {
	Env.init({ NODE_ENV: 'test', FRONTEND_URL: TEST_FRONTEND_URL, AUTH_ISSUER_URL: ISSUER });
});

/** An access token for `userId`, minted for `clientID` and so carrying it as `aud`. */
async function tokenFor(userId: string, clientID: string): Promise<string> {
	return new SignJWT({
		mode: 'access',
		type: 'user',
		properties: { userID: userId, linkedAccountID: '' }
	})
		.setProtectedHeader({ alg: 'ES256', kid: 'test', typ: 'JWT' })
		.setIssuer(ISSUER)
		.setAudience(clientID)
		.setSubject(`user:${userId}`)
		.setExpirationTime('15m')
		.sign(keys.privateKey);
}

async function person(label: string) {
	const owner = await Fixtures.owner(label);
	createdUserIds.push(owner.userId);
	return owner;
}

function call(method: string, path: string, token: string, body?: unknown) {
	return app.request(
		path,
		{
			method,
			headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
			body: body === undefined ? undefined : JSON.stringify(body)
		},
		env
	);
}

describe('a sign-in made by the installer', () => {
	test('can ask for an install token', async () => {
		const owner = await person('aud-ok');
		const response = await call(
			'POST',
			'/machine/install-token',
			await tokenFor(owner.userId, 'installer'),
			{}
		);
		expect(response.status).toBe(200);
		const body = (await response.json()) as any;
		expect(body.data.token).toStartWith('nit_');
	});

	test('can do nothing else', async () => {
		const owner = await person('aud-refused');
		const token = await tokenFor(owner.userId, 'installer');

		const elsewhere: [string, string][] = [
			['GET', '/user'],
			['GET', '/machine'],
			['POST', '/machine/register'],
			['POST', '/access-token']
		];
		for (const [method, path] of elsewhere) {
			const response = await call(method, path, token, method === 'POST' ? {} : undefined);
			expect(response.status).toBe(403);
			expect((await response.json()) as any).toEqual({
				type: 'forbidden',
				code: 'insufficient_permissions',
				message: 'This sign-in can only add a host'
			});
		}
	});

	test('every other client is unaffected', async () => {
		const owner = await person('aud-desktop');
		const token = await tokenFor(owner.userId, 'desktop');
		expect((await call('GET', '/user', token)).status).toBe(200);
		expect((await call('POST', '/machine/install-token', token, {})).status).toBe(200);
	});
});

describe('how many install tokens one person may have', () => {
	test('three unspent at once, then a 429 a terminal can print', async () => {
		const owner = await person('limit-outstanding');
		const token = await tokenFor(owner.userId, 'installer');
		for (let i = 0; i < 3; i++) {
			expect((await call('POST', '/machine/install-token', token, {})).status).toBe(200);
		}
		const refused = await call('POST', '/machine/install-token', token, {});
		expect(refused.status).toBe(429);
		expect((await refused.json()) as any).toEqual({
			type: 'rate_limit',
			code: 'too_many_requests',
			message:
				'You have 3 install tokens that have not been used yet. Use one, or wait for them to expire.'
		});
	});

	test('five an hour, even when every one was spent', async () => {
		const owner = await person('limit-hourly');
		const token = await tokenFor(owner.userId, 'installer');
		for (let i = 0; i < 5; i++) {
			const issued = await call('POST', '/machine/install-token', token, {});
			expect(issued.status).toBe(200);
			const { data } = (await issued.json()) as any;
			const installed = await app.request('/machine/install', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ token: data.token, label: `host-${i}` })
			});
			expect(installed.status).toBe(200);
		}
		const refused = await call('POST', '/machine/install-token', token, {});
		expect(refused.status).toBe(429);
		expect((await refused.json()) as any).toEqual({
			type: 'rate_limit',
			code: 'too_many_requests',
			message: 'You have made 5 install tokens in the last hour. Try again later.'
		});
	});
});
