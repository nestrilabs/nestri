import { beforeEach, describe, expect, test } from 'bun:test';

import { object, string } from 'valibot';

import { CodeProvider } from '../src/provider/code.js';
import { issuer } from '../src/issuer.js';
import { MemoryStorage } from '../src/storage/memory.js';
import { createSubjects } from '../src/subject.js';

const subjects = createSubjects({ user: object({ email: string() }) });

let sent: string[] = [];

const auth = issuer({
	storage: MemoryStorage(),
	subjects,
	allow: async () => true,
	providers: {
		code: CodeProvider({
			maxAttempts: 3,
			maxSends: 2,
			sendWindow: 3600,
			resendInterval: 0,
			request: async (_req, _state, _form, error) =>
				new Response(JSON.stringify({ error: error?.type ?? null }), {
					status: 200,
					headers: { 'content-type': 'application/json' }
				}),
			sendCode: async (claims, code) => {
				if (!claims.email?.includes('@')) {
					return { type: 'invalid_claim', key: 'email', value: claims.email ?? '' };
				}
				sent.push(code);
			}
		})
	},
	success: async (ctx, value) => ctx.subject('user', { email: (value as any).claims.email })
});

const ORIGIN = 'https://auth.example.com';

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

async function post(cookies: ReturnType<typeof jar>, body: Record<string, string>) {
	const response = await auth.request(`${ORIGIN}/code/authorize`, {
		method: 'POST',
		headers: { cookie: cookies.header(), 'content-type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams(body)
	});
	cookies.absorb(response);
	return response;
}

/**
 * Begin an authorization the way a client does, so success has somewhere to go.
 *
 * Without this there is no authorization state and a correct code produces
 * tokens rather than the redirect a browser flow ends in — which would make
 * "did this sign in?" a different question in the test than in the product.
 */
async function begin() {
	const cookies = jar();
	const url = new URL(`${ORIGIN}/authorize`);
	url.searchParams.set('client_id', 'test');
	url.searchParams.set('redirect_uri', 'https://client.example.com/callback');
	url.searchParams.set('response_type', 'code');
	url.searchParams.set('provider', 'code');
	cookies.absorb(await auth.request(url.toString()));
	return cookies;
}

/** Start a sign-in and ask for a code, coming back with the cookies and the code. */
async function ask(email: string) {
	const cookies = await begin();
	await post(cookies, { action: 'request', email });
	return { cookies, code: sent.at(-1)! };
}

/** What the stub UI reported, so a test can name the error rather than a status. */
async function errorOf(response: Response) {
	return ((await response.clone().json()) as { error: string | null }).error;
}

beforeEach(() => {
	sent = [];
});

describe('signing in with a code', () => {
	test('the right code signs you in', async () => {
		const { cookies, code } = await ask('right@example.com');
		const response = await post(cookies, { action: 'verify', code });
		expect(response.status).toBe(302);
	});

	test('a wrong code is refused and says so', async () => {
		const { cookies, code } = await ask('wrong@example.com');
		const response = await post(cookies, { action: 'verify', code: code === '000000' ? '111111' : '000000' });
		expect(response.status).toBe(200);
		expect(await errorOf(response)).toBe('invalid_code');
	});
});

/**
 * The attack a six-digit pin invites, and what stops it.
 *
 * The code travels in an encrypted cookie the caller holds, and the caller is
 * not necessarily the person the code was mailed to — anybody can type somebody
 * else's address into the first screen. So the only thing between an attacker
 * and an account is how many times they may guess, and that number has to be
 * kept somewhere they cannot reach.
 */
describe('guessing the code', () => {
	test('runs out of guesses long before it runs out of codes', async () => {
		const { cookies, code } = await ask('budget@example.com');
		const wrong = code === '000000' ? '111111' : '000000';

		expect(await errorOf(await post(cookies, { action: 'verify', code: wrong }))).toBe(
			'invalid_code'
		);
		expect(await errorOf(await post(cookies, { action: 'verify', code: wrong }))).toBe(
			'invalid_code'
		);
		expect(await errorOf(await post(cookies, { action: 'verify', code: wrong }))).toBe(
			'invalid_code'
		);

		// Out of budget. The next guess is refused whether or not it is right.
		expect(await errorOf(await post(cookies, { action: 'verify', code: wrong }))).toBe(
			'rate_limit'
		);
	});

	test('the real code stops working once the guesses are spent', async () => {
		const { cookies, code } = await ask('spent@example.com');
		const wrong = code === '000000' ? '111111' : '000000';
		for (let i = 0; i < 3; i++) await post(cookies, { action: 'verify', code: wrong });

		const response = await post(cookies, { action: 'verify', code });
		expect(response.status).toBe(200);
		expect(await errorOf(response)).toBe('rate_limit');
	});

	// The counter would be worthless if it lived where the guesser does. This
	// replays the cookie from before any guess was made, which is the cheapest
	// way to wind back anything held in one.
	test('replaying an earlier cookie does not hand back the spent guesses', async () => {
		const { cookies, code } = await ask('replay@example.com');
		const untouched = cookies.header();
		const wrong = code === '000000' ? '111111' : '000000';
		for (let i = 0; i < 3; i++) await post(cookies, { action: 'verify', code: wrong });

		const replayed = await auth.request(`${ORIGIN}/code/authorize`, {
			method: 'POST',
			headers: { cookie: untouched, 'content-type': 'application/x-www-form-urlencoded' },
			body: new URLSearchParams({ action: 'verify', code: wrong })
		});
		expect(await errorOf(replayed)).toBe('rate_limit');
	});

	test('a code is spent when it is used, so its guesses do not carry over', async () => {
		const { cookies, code } = await ask('once@example.com');
		expect((await post(cookies, { action: 'verify', code })).status).toBe(302);

		const again = await post(cookies, { action: 'verify', code });
		expect(again.status).toBe(200);
	});
});

describe('asking for codes', () => {
	test('a fresh code comes with a fresh budget of guesses', async () => {
		const first = await ask('fresh-a@example.com');
		const wrong = '000000' === first.code ? '111111' : '000000';
		for (let i = 0; i < 3; i++) await post(first.cookies, { action: 'verify', code: wrong });
		expect(await errorOf(await post(first.cookies, { action: 'verify', code: wrong }))).toBe(
			'rate_limit'
		);

		// Starting over is allowed. It costs a code sent to the mailbox being
		// aimed at, which is where somebody would notice.
		const second = await ask('fresh-b@example.com');
		expect(second.code).not.toBe(first.code);
		expect((await post(second.cookies, { action: 'verify', code: second.code })).status).toBe(302);
	});

	test('a mailbox cannot be sent codes forever', async () => {
		const email = 'flood@example.com';
		const { cookies } = await ask(email);
		expect(await errorOf(await post(cookies, { action: 'resend', email }))).toBe(null);
		expect(await errorOf(await post(cookies, { action: 'resend', email }))).toBe('rate_limit');
		expect(sent).toHaveLength(2);
	});

	// The budget was once held per sign-in attempt, which bounded nothing: the
	// caller decides how many attempts to start, and starting one costs a
	// discarded cookie. Both of these walk around a per-attempt budget and land
	// on the mailbox anyway, which is why the count lives there.
	test('replaying an earlier cookie does not buy more codes', async () => {
		const email = 'replay-send@example.com';
		const { cookies } = await ask(email);
		const untouched = cookies.header();
		await post(cookies, { action: 'resend', email });
		expect(sent).toHaveLength(2);

		const replayed = await auth.request(`${ORIGIN}/code/authorize`, {
			method: 'POST',
			headers: { cookie: untouched, 'content-type': 'application/x-www-form-urlencoded' },
			body: new URLSearchParams({ action: 'resend', email })
		});
		expect(await errorOf(replayed)).toBe('rate_limit');
		expect(sent).toHaveLength(2);
	});

	test('starting over does not buy more codes either', async () => {
		const email = 'restart-send@example.com';
		await ask(email);
		await ask(email);
		expect(sent).toHaveLength(2);

		const third = await begin();
		expect(await errorOf(await post(third, { action: 'request', email }))).toBe('rate_limit');
		expect(sent).toHaveLength(2);
	});

	// Each resend used to leave the code before it live, with a budget of
	// guesses of its own. Five resends meant five working codes and five times
	// the chances, so asking for a new code was how you bought more tries at
	// the old one.
	test('a resend retires the code before it', async () => {
		const email = 'retire@example.com';
		const { cookies, code: first } = await ask(email);
		const untouched = cookies.header();
		await post(cookies, { action: 'resend', email });
		expect(sent.at(-1)).not.toBe(first);

		const withOldCode = await auth.request(`${ORIGIN}/code/authorize`, {
			method: 'POST',
			headers: { cookie: untouched, 'content-type': 'application/x-www-form-urlencoded' },
			body: new URLSearchParams({ action: 'verify', code: first })
		});
		expect(withOldCode.status).toBe(200);
		expect(await errorOf(withOldCode)).toBe('rate_limit');
	});

	test('a bad address still gets told it is a bad address', async () => {
		const cookies = await begin();
		const response = await post(cookies, { action: 'request', email: 'not-an-address' });
		expect(await errorOf(response)).toBe('invalid_claim');
		expect(sent).toHaveLength(0);
	});
});
