import { expect, test } from 'bun:test';

import { object, string } from 'valibot';

import { createClient } from '../src/client.js';
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
	success: async (ctx) => {
		return ctx.subject('user', {
			userID: '123'
		});
	},
	ttl: {
		access: 1
	},
	providers: {
		dummy: {
			type: 'dummy',
			init(route, ctx) {
				route.get('/authorize', async (c) => {
					return ctx.success(c, {
						email: 'foo@bar.com'
					});
				});
			}
		}
	}
});

test('code flow', async () => {
	const client = createClient({
		issuer: 'https://auth.example.com',
		clientID: '123',
		fetch: (a, b) => Promise.resolve(auth.request(a, b))
	});
	const [verifier, authorization] = await client.pkce('https://client.example.com/callback');
	let response = await auth.request(authorization);
	expect(response.status).toBe(302);
	response = await auth.request(response.headers.get('location')!, {
		headers: {
			cookie: response.headers.get('set-cookie')!
		}
	});
	expect(response.status).toBe(302);
	const location = new URL(response.headers.get('location')!);
	const code = location.searchParams.get('code');
	expect(code).not.toBeNull();
	const exchanged = await client.exchange(code!, 'https://client.example.com/callback', verifier);
	if (exchanged.err) throw exchanged.err;
	expect(exchanged.tokens.access).toBeTruthy();
	expect(exchanged.tokens.refresh).toBeTruthy();
	const verified = await client.verify(subjects, exchanged.tokens.access);
	if (verified.err) throw verified.err;
	expect(verified.subject.type).toBe('user');
	if (verified.subject.type !== 'user') throw new Error('Invalid subject');
	expect(verified.subject.properties.userID).toBe('123');
	await new Promise((resolve) => setTimeout(resolve, 2000));
	const failed = await client.verify(subjects, exchanged.tokens.access);
	expect(failed.err).toBeInstanceOf(Error);
	const next = await client.verify(subjects, exchanged.tokens.access, {
		refresh: exchanged.tokens.refresh
	});
	if (next.err) throw next.err;
	expect(next.tokens?.access).toBeDefined();
	expect(next.tokens?.refresh).toBeDefined();
	expect(next.tokens?.access).not.toEqual(exchanged.tokens.access);
	expect(next.tokens?.refresh).not.toEqual(exchanged.tokens.refresh);
	await client.verify(subjects, next.tokens!.access!);
});
