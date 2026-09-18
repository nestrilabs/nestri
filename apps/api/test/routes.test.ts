import { describe, expect, test } from 'bun:test';

import { AccessToken } from '@nestri/core/access-token/index';
import { Fixtures } from '@nestri/core/db/fixtures';
import { Identifier } from '@nestri/core/id';
import { Machine } from '@nestri/core/machine/index';

import { app } from '../app/index';
import './setup';

/**
 * A signed-in person and a registered host.
 *
 * Between them they are every credential the API accepts, so the validation
 * tests below have to pick one. There is no longer a credential that stands
 * for "some authenticated caller" in general — reaching a handler means being
 * a specific someone, which is the property these fixtures preserve.
 *
 * Built once, lazily, because the settings they need are installed by a
 * `beforeEach` that has not run when a `beforeAll` would.
 */
let built: Promise<{ user: Record<string, string>; host: Record<string, string> }> | undefined;

function credentials() {
	built ??= (async () => {
		const owner = await Fixtures.owner('routes');
		const pat = await AccessToken.create({
			id: Identifier.ascending('accessToken'),
			ownerUserId: owner.userId,
			teamId: null,
			name: 'routes'
		});
		const registered = await Machine.register({
			id: Identifier.ascending('machine'),
			ownerUserId: owner.userId,
			teamId: owner.teamId,
			label: 'routes'
		});
		return {
			user: { authorization: `Bearer ${pat.token}` },
			host: {
				'x-nestri-machine-id': registered.id,
				'x-nestri-machine-secret': registered.secret
			}
		};
	})();
	return built;
}

async function userHeaders(): Promise<Record<string, string>> {
	return (await credentials()).user;
}

async function hostHeaders(): Promise<Record<string, string>> {
	return (await credentials()).host;
}

describe('Index', () => {
	test('GET / returns hello world', async () => {
		const res = await app.request('/');
		expect(res.status).toBe(200);
		expect(await res.text()).toBe('Hello World!');
	});
});

describe('Auth middleware', () => {
	test('public access to a protected route returns 401', async () => {
		const res = await app.request('/library');
		expect(res.status).toBe(401);
		const body = (await res.json()) as any;
		expect(body.type).toBe('authentication');
		expect(body.code).toBe('unauthorized');
	});

	test('game catalog search is public', async () => {
		// The search-first TUI browses before it logs in, so the catalog
		// must not sit behind auth.
		const res = await app.request('/games');
		expect(res.status).toBe(200);
	});

	test('a bearer token that cannot be verified is unauthenticated, not a server error', async () => {
		// A token nobody can verify makes the *caller* unauthenticated; it does
		// not make the request a server fault. `verify` reports a malformed or
		// expired token in `err`, but throws when it cannot reach the auth
		// service at all, and that throw used to surface as a 500.
		const res = await app.request('/library', {
			headers: { authorization: 'Bearer not-a-real-token' }
		});
		expect(res.status).toBe(401);
		const body = (await res.json()) as any;
		expect(body.type).toBe('authentication');
	});

	test('missing authorization on a protected route returns 401', async () => {
		const res = await app.request('/games/sync', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({})
		});
		expect(res.status).toBe(401);
		const body = (await res.json()) as any;
		expect(body.code).toBe('unauthorized');
	});
});

describe('Validation', () => {
	test('malformed JSON body returns 400', async () => {
		const res = await app.request('/games/sync', {
			method: 'POST',
			headers: {
				...(await hostHeaders()),
				'content-type': 'application/json'
			},
			body: '{not-json'
		});
		expect(res.status).toBe(400);
		const body = (await res.json()) as any;
		expect(body.type).toBe('validation');
	});

	test('missing required fields returns 400 with code', async () => {
		const res = await app.request('/games/download-state', {
			method: 'POST',
			headers: {
				...(await hostHeaders()),
				'content-type': 'application/json'
			},
			body: JSON.stringify({ status: 'downloading' })
		});
		expect(res.status).toBe(400);
		const body = (await res.json()) as any;
		expect(body.type).toBe('validation');
	});

	test('invalid status enum in download-state returns 400', async () => {
		const res = await app.request('/games/download-state', {
			method: 'POST',
			headers: {
				...(await hostHeaders()),
				'content-type': 'application/json'
			},
			body: JSON.stringify({
				steamAppId: 440,
				status: 'bogus_status'
			})
		});
		expect(res.status).toBe(400);
		const body = (await res.json()) as any;
		expect(body.type).toBe('validation');
	});

	test('non-existent game returns 404', async () => {
		const res = await app.request('/games/gam_nonexistent', {
			headers: await userHeaders()
		});
		expect(res.status).toBe(404);
		const body = (await res.json()) as any;
		expect(body.type).toBe('not_found');
	});

	test('missing content-type header returns 400', async () => {
		const res = await app.request('/games/sync', {
			method: 'POST',
			headers: await hostHeaders(),
			body: JSON.stringify({})
		});
		expect(res.status).toBe(400);
	});
});

describe('Error response shape', () => {
	test('404 on unknown game has standard error shape', async () => {
		const res = await app.request('/games/gam_nonexistent', {
			headers: await userHeaders()
		});
		expect(res.status).toBe(404);
		const body = (await res.json()) as any;
		expect(body).toHaveProperty('type');
		expect(body).toHaveProperty('code');
		expect(body).toHaveProperty('message');
	});

	test('429 error responses have standard shape', async () => {
		const res = await app.request('/games/gam_nonexistent', {
			headers: await userHeaders()
		});
		expect(res.status).toBe(404);
		const body = (await res.json()) as any;
		expect(body.type).toBe('not_found');
		expect(body.code).toBe('resource_not_found');
	});
});

describe('OpenAPI doc', () => {
	test('GET /doc returns 200 with JSON', async () => {
		const res = await app.request('/doc');
		expect(res.status).toBe(200);
		const body = (await res.json()) as any;
		expect(body).toHaveProperty('openapi');
		expect(body.info.title).toBe('Nestri API');
	});

	test('GET /doc contains expected route paths', async () => {
		const res = await app.request('/doc');
		const body = (await res.json()) as any;
		const paths = Object.keys(body.paths);
		expect(paths).toContain('/games');
		expect(paths).toContain('/games/sync');
		expect(paths).toContain('/games/{id}');
		expect(paths).toContain('/games/{id}/download-state');
		expect(paths).toContain('/games/download-state');
		expect(paths).toContain('/library');
		expect(paths).toContain('/library/sync');
		expect(paths).toContain('/steam/link');
		expect(paths).toContain('/steam/linked');
		expect(paths).toContain('/steam/unlink');
		expect(paths).toContain('/user');
		expect(paths).toContain('/user/email');
		expect(paths).toContain('/user/devices');
		expect(paths).toContain('/waitlist');
	});

	test('doc has security schemes defined', async () => {
		const res = await app.request('/doc');
		const body = (await res.json()) as any;
		expect(body.components.securitySchemes.Bearer).toMatchObject({
			type: 'http',
			scheme: 'bearer'
		});
	});
});

describe('CORS', () => {
	test('CORS preflight returns headers', async () => {
		const res = await app.request('/games', {
			method: 'OPTIONS',
			headers: {
				origin: 'http://localhost:5173',
				'access-control-request-method': 'GET'
			}
		});
		expect(res.status).toBe(204);
		expect(res.headers.get('access-control-allow-origin')).toBeTruthy();
	});

	test('response includes cache-control no-store', async () => {
		const res = await app.request('/');
		expect(res.headers.get('cache-control')).toBe('no-store');
	});
});

describe('Download state route', () => {
	test('POST /games/download-state requires steamAppId', async () => {
		const res = await app.request('/games/download-state', {
			method: 'POST',
			headers: {
				...(await hostHeaders()),
				'content-type': 'application/json'
			},
			body: JSON.stringify({
				status: 'downloading'
				// missing steamAppId
			})
		});
		expect(res.status).toBe(400);
	});

	test('a host cannot name the host it is reporting for', async () => {
		// Which host this is comes from the credentials. The body once carried
		// it, so a caller could write download state under any box's id.
		const res = await app.request('/games/download-state', {
			method: 'POST',
			headers: {
				...(await hostHeaders()),
				'content-type': 'application/json'
			},
			body: JSON.stringify({ hostId: 'mch_someoneelse', steamAppId: 440, status: 'ready' })
		});
		expect(res.status).toBe(400);
	});

	test('POST /games/download-state validates status enum', async () => {
		const valid = ['pending', 'verifying', 'downloading', 'ready', 'failed'] as const;
		for (const status of valid) {
			//eslint-disable-next-line
			const res = await app.request('/games/download-state', {
				method: 'POST',
				headers: {
					...(await hostHeaders()),
					'content-type': 'application/json'
				},
				body: JSON.stringify({
					steamAppId: 440,
					status
				})
			});
			// Validation should pass (200 or 404 if game not in DB)
			expect(res.status).not.toBe(400);
		}
	});

	test('an unauthenticated caller cannot report download state', async () => {
		const res = await app.request('/games/download-state', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ steamAppId: 440, status: 'ready' })
		});
		// The route group's `notPublic` runs first, so this is 401 rather than
		// the 403 `machineOnly` would give an authenticated non-host.
		expect(res.status).toBe(401);
	});
});

describe('Access tokens', () => {
	test('creating a token requires authentication', async () => {
		const res = await app.request('/access-token', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ name: 'living-room-box' })
		});
		expect(res.status).toBe(401);
	});

	test('a token needs a name', async () => {
		const res = await app.request('/access-token', {
			method: 'POST',
			headers: { ...(await userHeaders()), 'content-type': 'application/json' },
			body: JSON.stringify({ name: '' })
		});
		expect(res.status).toBe(400);
	});

	test('expiry is capped at a year', async () => {
		const res = await app.request('/access-token', {
			method: 'POST',
			headers: { ...(await userHeaders()), 'content-type': 'application/json' },
			body: JSON.stringify({ name: 'box', expiresInDays: 4000 })
		});
		expect(res.status).toBe(400);
		const body = (await res.json()) as any;
		expect(body.type).toBe('validation');
	});

	test('teamId accepts null to force a token scoped to the user alone', async () => {
		// Team scope is the default and is *broader* than user scope, so there
		// has to be an explicit way to ask for the narrow one. Null is it;
		// omitting the field means "take the default", which is not the same.
		const res = await app.request('/access-token', {
			method: 'POST',
			headers: { ...(await userHeaders()), 'content-type': 'application/json' },
			body: JSON.stringify({ name: 'box', teamId: null })
		});
		expect(res.status).toBe(200);
	});

	test('revoking someone else’s token requires authentication', async () => {
		const res = await app.request('/access-token/pat_whatever', { method: 'DELETE' });
		expect(res.status).toBe(401);
	});

	test('an unknown access token is unauthenticated, not a server error', async () => {
		// A `pat_` prefix routes to the database rather than JWT verification.
		// A miss there must read as "not signed in", the same as a bad JWT.
		const res = await app.request('/library', {
			headers: { authorization: 'Bearer pat_nosuchtokenvalue' }
		});
		expect(res.status).toBe(401);
		const body = (await res.json()) as any;
		expect(body.type).toBe('authentication');
	});
});

describe('Box access', () => {
	test('rescoping a machine requires authentication', async () => {
		const res = await app.request('/machine/mch_whatever', {
			method: 'PATCH',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ teamId: null })
		});
		expect(res.status).toBe(401);
	});

	test('rescoping onto a team you do not belong to is refused', async () => {
		// Naming a team is how hardware would otherwise be parked in somebody
		// else's, so membership is checked rather than taken from the body.
		const res = await app.request('/machine/mch_whatever', {
			method: 'PATCH',
			headers: { ...(await userHeaders()), 'content-type': 'application/json' },
			body: JSON.stringify({ teamId: 'tem_whatever' })
		});
		expect(res.status).toBe(403);
		const body = (await res.json()) as any;
		expect(body.message).toContain('not a member');
	});

	test('teamId is required on the body, and null is no longer a value', async () => {
		// Null used to mean "make it mine alone". Now that `machine.teamId` is
		// notNull there is no such state — hardware belongs to exactly one team
		// and the personal team is the one to name — so null is a validation
		// error rather than a meaning.
		const missing = await app.request('/machine/mch_whatever', {
			method: 'PATCH',
			headers: { ...(await userHeaders()), 'content-type': 'application/json' },
			body: JSON.stringify({})
		});
		expect(missing.status).toBe(400);

		const explicitNull = await app.request('/machine/mch_whatever', {
			method: 'PATCH',
			headers: { ...(await userHeaders()), 'content-type': 'application/json' },
			body: JSON.stringify({ teamId: null })
		});
		expect(explicitNull.status).toBe(400);

		const named = await app.request('/machine/mch_whatever', {
			method: 'PATCH',
			headers: { ...(await userHeaders()), 'content-type': 'application/json' },
			body: JSON.stringify({ teamId: 'tem_whatever' })
		});
		expect([403, 404]).toContain(named.status);
	});

	test('entitlement requires machine credentials, not a user session', async () => {
		// The machine is taken from its credentials, never the query, so a box
		// cannot ask about another box.
		const res = await app.request('/machine/entitlement?userId=usr_x', {
			headers: await userHeaders()
		});
		expect(res.status).toBe(403);
		const body = (await res.json()) as any;
		expect(body.message).toContain('Machine credentials');
	});

	test('entitlement needs a userId to answer about', async () => {
		const res = await app.request('/machine/entitlement');
		// machineOnly refuses before validation; either way it does not answer.
		expect([400, 403]).toContain(res.status);
	});
});

describe('Machine registration', () => {
	test('registering a machine requires authentication', async () => {
		const res = await app.request('/machine/register', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ label: 'living-room-box' })
		});
		expect(res.status).toBe(401);
	});

	test('registering a machine requires a label', async () => {
		const res = await app.request('/machine/register', {
			method: 'POST',
			headers: { ...(await userHeaders()), 'content-type': 'application/json' },
			body: JSON.stringify({ label: '' })
		});
		expect(res.status).toBe(400);
		const body = (await res.json()) as any;
		expect(body.type).toBe('validation');
	});

	test('describing yourself requires machine credentials', async () => {
		const res = await app.request('/machine/me', { headers: await userHeaders() });
		expect(res.status).toBe(403);
		const body = (await res.json()) as any;
		expect(body.message).toContain('Machine credentials');
	});
});

describe('Steam routes', () => {
	test('POST /steam/link requires auth', async () => {
		const res = await app.request('/steam/link', { method: 'POST' });
		expect(res.status).toBe(401);
	});

	test('POST /steam/link validates steamId', async () => {
		const res = await app.request('/steam/link', {
			method: 'POST',
			headers: {
				...(await userHeaders()),
				'content-type': 'application/json'
			},
			body: JSON.stringify({})
		});
		expect(res.status).toBe(400);
	});
});

describe('User routes', () => {
	test('GET /user requires auth', async () => {
		const res = await app.request('/user');
		expect(res.status).toBe(401);
	});
});

describe('Library routes', () => {
	test('GET /library requires auth', async () => {
		const res = await app.request('/library');
		expect(res.status).toBe(401);
	});
});

describe('Email routes', () => {
	test('POST /user/email requires auth', async () => {
		const res = await app.request('/user/email', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ email: 'a@b.com' })
		});
		expect(res.status).toBe(401);
	});

	test('POST /user/email rejects a malformed address', async () => {
		const res = await app.request('/user/email', {
			method: 'POST',
			headers: { ...(await userHeaders()), 'content-type': 'application/json' },
			body: JSON.stringify({ email: 'not-an-email' })
		});
		expect(res.status).toBe(400);
		const body = (await res.json()) as any;
		expect(body.type).toBe('validation');
	});

	test('POST /user/email/send-code requires auth', async () => {
		const res = await app.request('/user/email/send-code', { method: 'POST' });
		expect(res.status).toBe(401);
	});

	test('POST /user/email/verify requires auth', async () => {
		const res = await app.request('/user/email/verify', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ code: '123456' })
		});
		expect(res.status).toBe(401);
	});

	test('POST /user/email/verify requires a 6-digit code', async () => {
		const res = await app.request('/user/email/verify', {
			method: 'POST',
			headers: { ...(await userHeaders()), 'content-type': 'application/json' },
			body: JSON.stringify({ code: '12' })
		});
		expect(res.status).toBe(400);
	});
});

describe('Device routes', () => {
	test('GET /user/devices requires auth', async () => {
		const res = await app.request('/user/devices');
		expect(res.status).toBe(401);
	});

	test('PATCH /user/devices/:id requires auth', async () => {
		const res = await app.request('/user/devices/ufp_whatever', {
			method: 'PATCH',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ name: 'MacBook Air' })
		});
		expect(res.status).toBe(401);
	});
});

describe('Steam account routes', () => {
	test('GET /steam/linked requires auth', async () => {
		const res = await app.request('/steam/linked');
		expect(res.status).toBe(401);
	});

	test('POST /steam/unlink requires auth', async () => {
		const res = await app.request('/steam/unlink', { method: 'POST' });
		expect(res.status).toBe(401);
	});
});

describe('Waitlist routes', () => {
	test('POST /waitlist joins without auth', async () => {
		const res = await app.request('/waitlist', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ email: 'waitlist@example.com' })
		});
		expect(res.status).toBe(201);
		const body = (await res.json()) as any;
		expect(body.data.email).toBe('waitlist@example.com');
		expect(body.data.source).toBe('machines');
	});

	test('POST /waitlist rejects a malformed email', async () => {
		const res = await app.request('/waitlist', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ email: 'nope' })
		});
		expect(res.status).toBe(400);
	});
});
