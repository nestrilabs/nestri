import { describe, expect, test } from 'bun:test';

import { sendVerificationCode } from '../src/email.js';

describe('sending a sign-in code', () => {
	test('with nothing configured outside production, it does not block a sign-in', async () => {
		await sendVerificationCode({ NODE_ENV: 'development' }, 'ada@example.com', '123456');
	});

	test('with nothing configured in production, it says so instead of pretending', async () => {
		await expect(
			sendVerificationCode({ NODE_ENV: 'production' }, 'ada@example.com', '123456')
		).rejects.toThrow(/not configured/);
	});

	test('a configured mailer is called with the address and the code', async () => {
		let seen: { url: string; body: any; auth: string | null } | null = null;
		const original = globalThis.fetch;
		globalThis.fetch = (async (url: any, init: any) => {
			seen = {
				url: String(url),
				body: JSON.parse(init.body),
				auth: new Headers(init.headers).get('authorization')
			};
			return new Response('{}', { status: 200 });
		}) as unknown as typeof fetch;

		try {
			await sendVerificationCode(
				{
					NODE_ENV: 'production',
					EMAIL_SEND_URL: 'https://mail.example.com/send',
					EMAIL_API_KEY: 'key',
					EMAIL_FROM: 'hello@nestri.io'
				},
				'ada@example.com',
				'123456'
			);
		} finally {
			globalThis.fetch = original;
		}

		expect(seen!.url).toBe('https://mail.example.com/send');
		expect(seen!.auth).toBe('Bearer key');
		expect(seen!.body.to).toEqual(['ada@example.com']);
		expect(seen!.body.from).toBe('hello@nestri.io');
		expect(seen!.body.text).toContain('123456');
	});

	test('a refusal from the mailer is not swallowed', async () => {
		const original = globalThis.fetch;
		globalThis.fetch = (async () =>
			new Response('over quota', { status: 429 })) as unknown as typeof fetch;
		try {
			await expect(
				sendVerificationCode(
					{
						EMAIL_SEND_URL: 'https://mail.example.com/send',
						EMAIL_API_KEY: 'key',
						EMAIL_FROM: 'hello@nestri.io'
					},
					'ada@example.com',
					'123456'
				)
			).rejects.toThrow(/over quota/);
		} finally {
			globalThis.fetch = original;
		}
	});
});

describe('the worker itself', () => {
	// Cheap, and it catches the thing a type check cannot: the sign-in screen
	// lives in a `.tsx` file, and whether that file can be imported across a
	// package boundary at run time is decided by the package's export map
	// rather than by the compiler.
	test('loads, with every provider it wires resolvable', async () => {
		const worker = await import('../src/index.js');
		expect(typeof worker.default.fetch).toBe('function');
	});
});
