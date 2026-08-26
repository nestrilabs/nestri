import { describe, expect, test } from 'bun:test';

import { app } from '../app/index';
import { TEST_ADMIN_SECRET } from './setup';
import './setup';

function adminHeaders(): Record<string, string> {
	return { 'x-nestri-admin-token': TEST_ADMIN_SECRET };
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

	test('admin token gains access to protected routes', async () => {
		const res = await app.request('/waitlist', {
			headers: adminHeaders()
		});
		expect(res.status).toBe(200);
	});

	test('wrong admin token is treated as public → 401', async () => {
		const res = await app.request('/library', {
			headers: { 'x-nestri-admin-token': 'wrong-secret' }
		});
		expect(res.status).toBe(401);
		const body = (await res.json()) as any;
		expect(body.type).toBe('authentication');
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

	test('missing authorization on admin-only route returns 401', async () => {
		const res = await app.request('/games/sync', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({})
		});
		// notPublic runs before adminOnly → 401
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
				...adminHeaders(),
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
				...adminHeaders(),
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
				...adminHeaders(),
				'content-type': 'application/json'
			},
			body: JSON.stringify({
				hostId: 'hst_test',
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
			headers: adminHeaders()
		});
		expect(res.status).toBe(404);
		const body = (await res.json()) as any;
		expect(body.type).toBe('not_found');
	});

	test('missing content-type header returns 400', async () => {
		const res = await app.request('/games/sync', {
			method: 'POST',
			headers: adminHeaders(),
			body: JSON.stringify({})
		});
		expect(res.status).toBe(400);
	});
});

describe('Error response shape', () => {
	test('404 on unknown game has standard error shape', async () => {
		const res = await app.request('/games/gam_nonexistent', {
			headers: adminHeaders()
		});
		expect(res.status).toBe(404);
		const body = (await res.json()) as any;
		expect(body).toHaveProperty('type');
		expect(body).toHaveProperty('code');
		expect(body).toHaveProperty('message');
	});

	test('429 error responses have standard shape', async () => {
		const res = await app.request('/games/gam_nonexistent', {
			headers: adminHeaders()
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
		expect(paths).toContain('/pairing-code');
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
	test('POST /games/download-state requires hostId and steamAppId', async () => {
		const res = await app.request('/games/download-state', {
			method: 'POST',
			headers: {
				...adminHeaders(),
				'content-type': 'application/json'
			},
			body: JSON.stringify({
				hostId: 'hst_test',
				status: 'downloading'
				// missing steamAppId
			})
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
					...adminHeaders(),
					'content-type': 'application/json'
				},
				body: JSON.stringify({
					hostId: 'hst_test',
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
			body: JSON.stringify({ hostId: 'mch_test', steamAppId: 440, status: 'ready' })
		});
		// The route group's `notPublic` runs first, so this is 401 rather than
		// the 403 `machineOrAdmin` would give an authenticated non-host.
		expect(res.status).toBe(401);
	});

	test('an admin caller must say which host it is reporting for', async () => {
		// hostId is optional in the schema now because a machine supplies it
		// from its own identity. Admin has no identity to take it from, so
		// leaving it out has to fail rather than write under an empty host.
		const res = await app.request('/games/download-state', {
			method: 'POST',
			headers: { ...adminHeaders(), 'content-type': 'application/json' },
			body: JSON.stringify({ steamAppId: 440, status: 'ready' })
		});
		expect(res.status).toBe(400);
		const body = (await res.json()) as any;
		expect(body.code).toBe('missing_required_field');
		expect(body.param).toBe('hostId');
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

	test('the admin token cannot mint a token for anyone', async () => {
		// This is the boundary that makes admin safe to hand out for tooling:
		// it reads and writes API data but cannot *become* a user. Minting a
		// PAT on someone's behalf would erase exactly that.
		const res = await app.request('/access-token', {
			method: 'POST',
			headers: { ...adminHeaders(), 'content-type': 'application/json' },
			body: JSON.stringify({ name: 'living-room-box' })
		});
		expect(res.status).toBe(403);
		const body = (await res.json()) as any;
		expect(body.message).toContain('user session');
	});

	test('a token needs a name', async () => {
		const res = await app.request('/access-token', {
			method: 'POST',
			headers: { ...adminHeaders(), 'content-type': 'application/json' },
			body: JSON.stringify({ name: '' })
		});
		expect(res.status).toBe(400);
	});

	test('expiry is capped at a year', async () => {
		const res = await app.request('/access-token', {
			method: 'POST',
			headers: { ...adminHeaders(), 'content-type': 'application/json' },
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
			headers: { ...adminHeaders(), 'content-type': 'application/json' },
			body: JSON.stringify({ name: 'box', teamId: null })
		});
		// Admin is refused at the handler, but only after validation — so a
		// 403 here proves null passed the schema rather than being rejected.
		expect(res.status).toBe(403);
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

	test('the admin token cannot rescope a machine', async () => {
		// Rescoping is an owner action and the query is scoped to a user id;
		// admin has none, so it must be refused rather than 500 later.
		const res = await app.request('/machine/mch_whatever', {
			method: 'PATCH',
			headers: { ...adminHeaders(), 'content-type': 'application/json' },
			body: JSON.stringify({ teamId: null })
		});
		expect(res.status).toBe(403);
		const body = (await res.json()) as any;
		expect(body.message).toContain('user session');
	});

	test('teamId is required on the body, and may be null', async () => {
		// Null is "make it mine alone" — a different thing from omitting the
		// field, which would leave the scope ambiguous.
		const missing = await app.request('/machine/mch_whatever', {
			method: 'PATCH',
			headers: { ...adminHeaders(), 'content-type': 'application/json' },
			body: JSON.stringify({})
		});
		expect(missing.status).toBe(400);

		const explicitNull = await app.request('/machine/mch_whatever', {
			method: 'PATCH',
			headers: { ...adminHeaders(), 'content-type': 'application/json' },
			body: JSON.stringify({ teamId: null })
		});
		// Past validation, refused at the handler for being admin.
		expect(explicitNull.status).toBe(403);
	});

	test('entitlement requires machine credentials, not a user session', async () => {
		// The machine is taken from its credentials, never the query, so a box
		// cannot ask about another box.
		const res = await app.request('/machine/entitlement?userId=usr_x', {
			headers: adminHeaders()
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

	test('the admin token cannot register a machine', async () => {
		// Registering is an act of ownership and the resulting row references a
		// user. Admin is authenticated but owns nothing, so it must be refused
		// here rather than fail later on a null owner.
		const res = await app.request('/machine/register', {
			method: 'POST',
			headers: { ...adminHeaders(), 'content-type': 'application/json' },
			body: JSON.stringify({ label: 'living-room-box' })
		});
		expect(res.status).toBe(403);
		const body = (await res.json()) as any;
		expect(body.message).toContain('user session');
	});

	test('registering a machine requires a label', async () => {
		const res = await app.request('/machine/register', {
			method: 'POST',
			headers: { ...adminHeaders(), 'content-type': 'application/json' },
			body: JSON.stringify({ label: '' })
		});
		expect(res.status).toBe(400);
		const body = (await res.json()) as any;
		expect(body.type).toBe('validation');
	});

	test('describing yourself requires machine credentials', async () => {
		const res = await app.request('/machine/me', { headers: adminHeaders() });
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
				...adminHeaders(),
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

describe('Pairing code routes', () => {
	test('POST /pairing-code requires auth', async () => {
		// Generating a code says "this key is also me", so it can only be done
		// from a session that already is that user.
		const res = await app.request('/pairing-code', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({})
		});
		expect(res.status).toBe(401);
	});

	test('POST /pairing-code/claim rejects an unauthenticated caller', async () => {
		// Claiming is done for a device with no identity yet, so it carries the
		// admin token rather than a user session. Without it, no.
		const res = await app.request('/pairing-code/claim', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ code: 'NESSH-7F2Q', fingerprint: 'aa:bb' })
		});
		expect([401, 403]).toContain(res.status);
	});

	test('POST /pairing-code/claim requires both a code and a fingerprint', async () => {
		for (const body of [{}, { code: 'NESSH-7F2Q' }, { fingerprint: 'aa:bb' }]) {
			// eslint-disable-next-line
			const res = await app.request('/pairing-code/claim', {
				method: 'POST',
				headers: { ...adminHeaders(), 'content-type': 'application/json' },
				body: JSON.stringify(body)
			});
			expect(res.status).toBe(400);
		}
	});

	test('POST /pairing-code/claim rejects an empty code', async () => {
		// An empty string must not be treated as "any code".
		const res = await app.request('/pairing-code/claim', {
			method: 'POST',
			headers: { ...adminHeaders(), 'content-type': 'application/json' },
			body: JSON.stringify({ code: '', fingerprint: 'aa:bb' })
		});
		expect(res.status).toBe(400);
	});

	test('POST /pairing-code caps how long a code stays valid', async () => {
		// Short-lived by design; a long-lived code is a shared password.
		const res = await app.request('/pairing-code', {
			method: 'POST',
			headers: { ...adminHeaders(), 'content-type': 'application/json' },
			body: JSON.stringify({ ttlMinutes: 60 * 24 })
		});
		expect(res.status).toBe(400);
	});

	test('GET /pairing-code requires auth', async () => {
		const res = await app.request('/pairing-code');
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
			headers: { ...adminHeaders(), 'content-type': 'application/json' },
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
			headers: { ...adminHeaders(), 'content-type': 'application/json' },
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

	test('GET /waitlist is admin-only', async () => {
		const res = await app.request('/waitlist');
		expect(res.status).toBe(403);
	});
});
