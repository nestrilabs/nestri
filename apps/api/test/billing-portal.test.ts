import { afterAll, afterEach, describe, expect, test } from 'bun:test';

import { AccessToken } from '@nestri/core/access-token/index';
import { Polar } from '@nestri/core/billing/polar';
import { Fixtures } from '@nestri/core/db/fixtures';
import { testDb } from '@nestri/core/db/test';
import { Env } from '@nestri/core/env';
import { Identifier } from '@nestri/core/id';

import { app } from '../app/index';
import './setup';

const sql = testDb();
const createdUserIds: string[] = [];
const realFetch = globalThis.fetch;

async function person(label: string) {
	const owner = await Fixtures.owner(label);
	createdUserIds.push(owner.userId);
	const pat = await AccessToken.create({
		id: Identifier.ascending('accessToken'),
		ownerUserId: owner.userId,
		teamId: null,
		name: label
	});
	return { authorization: `Bearer ${pat.token}` };
}

function configure() {
	Env.init({
		NODE_ENV: 'test',
		FRONTEND_URL: 'http://localhost:5173',
		POLAR_ACCESS_TOKEN: 'polar_test',
		POLAR_PRODUCT_ID: 'prod_test'
	});
	Polar.reset();
}

/** Stand in for Polar only; every other request goes where it was going. */
function polarAnswers(status: number, body: unknown) {
	globalThis.fetch = (async (input: Request | string | URL, init?: RequestInit) => {
		const url = input instanceof Request ? input.url : String(input);
		if (url.includes('polar.sh')) {
			return new Response(JSON.stringify(body), {
				status,
				headers: { 'content-type': 'application/json' }
			});
		}
		return realFetch(input as never, init);
	}) as typeof fetch;
}

afterEach(() => {
	globalThis.fetch = realFetch;
	Polar.reset();
});

afterAll(async () => {
	if (createdUserIds.length > 0) {
		await sql`delete from "user" where id in ${sql(createdUserIds)}`;
	}
});

describe('GET /billing/portal', () => {
	test('a team Polar has never heard of gets a 404, not a 500', async () => {
		const headers = await person('portal-none');
		configure();
		polarAnswers(404, { error: 'ResourceNotFound', detail: 'Customer not found' });
		const res = await app.request('/billing/portal', { headers });
		expect(res.status).toBe(404);
		expect((await res.json()).message).toBe('This team has no billing yet');
	});

	test('an unknown external id answered with a 422 is the same 404', async () => {
		const headers = await person('portal-422');
		configure();
		polarAnswers(422, { detail: [{ loc: ['body'], msg: 'Customer does not exist', type: 'x' }] });
		const res = await app.request('/billing/portal', { headers });
		expect(res.status).toBe(404);
	});
});
