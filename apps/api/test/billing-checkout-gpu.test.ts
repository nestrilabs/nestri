import { createHmac } from 'node:crypto';

import { afterAll, afterEach, describe, expect, test } from 'bun:test';

import { AccessToken } from '@nestri/core/access-token/index';
import { Polar } from '@nestri/core/billing/polar';
import { Fixtures } from '@nestri/core/db/fixtures';
import { testDb } from '@nestri/core/db/test';
import { Env } from '@nestri/core/env';
import { Identifier } from '@nestri/core/id';
import { Machine } from '@nestri/core/machine/index';

import { app } from '../app/index';
import { TEST_FRONTEND_URL } from './setup';

const sql = testDb();
const createdUserIds: string[] = [];
const createdOrgIds: string[] = [];
const realFetch = globalThis.fetch;

const PAID = 'prod_paid';
const V710 = { model: 'AMD Radeon Pro V710', vramMib: 28672, pciId: '1002:7461' };
const RX = { model: 'AMD Radeon RX 9070', vramMib: 16384, pciId: '1002:7550' };
const H100 = { model: 'NVIDIA H100', vramMib: 81920, pciId: '10de:2330' };
const RTX = { model: 'NVIDIA RTX 4090', vramMib: 24576, pciId: '10de:2684' };

const secret = `whsec_${Buffer.from('d'.repeat(32)).toString('base64')}`;

function configure(organisationId?: string) {
	Env.init({
		NODE_ENV: 'test',
		FRONTEND_URL: TEST_FRONTEND_URL,
		POLAR_ACCESS_TOKEN: 'polar_test',
		POLAR_PRODUCT_ID: PAID,
		POLAR_WEBHOOK_SECRET: secret,
		...(organisationId ? { FLEET_ORGANISATION_ID: organisationId } : {})
	});
	Polar.reset();
}

async function person(label: string) {
	const owner = await Fixtures.owner(label);
	createdUserIds.push(owner.userId);
	const pat = await AccessToken.create({
		id: Identifier.ascending('accessToken'),
		ownerUserId: owner.userId,
		teamId: null,
		name: label
	});
	return {
		owner,
		headers: {
			authorization: `Bearer ${pat.token}`,
			'content-type': 'application/json'
		} as Record<string, string>
	};
}

async function fleet(gpus: (typeof V710)[][]) {
	const operator = await Fixtures.owner('operator');
	createdUserIds.push(operator.userId);
	const f = await Fixtures.fleet(operator, gpus.length);
	createdOrgIds.push(f.organisationId);
	for (const [i, g] of gpus.entries()) await Machine.setGpus({ id: f.machines[i]!.id, gpus: g });
	configure(f.organisationId);
	return f;
}

/** Stand in for Polar, remembering what was sent to create a checkout. */
function polarCheckout() {
	const sent: any[] = [];
	globalThis.fetch = (async (input: Request | string | URL, init?: RequestInit) => {
		const req = input instanceof Request ? input : new Request(String(input), init);
		if (req.url.includes('polar.sh')) {
			sent.push(await req.json());
			return new Response(JSON.stringify({ id: 'chk_1', url: 'https://polar.sh/pay/chk_1' }), {
				status: 201,
				headers: { 'content-type': 'application/json' }
			});
		}
		return realFetch(input as never, init);
	}) as typeof fetch;
	return sent;
}

let n = 0;
async function deliver(type: string, data: Record<string, unknown>) {
	const body = JSON.stringify({ type, data });
	const id = `msg_cg_${++n}`;
	const ts = Math.floor(Date.now() / 1000);
	// Standard Webhooks: HMAC-SHA256 over `id.timestamp.body`, keyed by the decoded secret.
	const signature = `v1,${createHmac('sha256', Buffer.from(secret.slice(6), 'base64'))
		.update(`${id}.${ts}.${body}`)
		.digest('base64')}`;
	return app.request('/billing/webhook', {
		method: 'POST',
		headers: {
			'webhook-id': id,
			'webhook-timestamp': String(ts),
			'webhook-signature': signature
		},
		body
	});
}

const paid = (teamId: string, sub: string, gpu?: string) => ({
	id: sub,
	productId: PAID,
	customer: { externalId: teamId },
	metadata: gpu ? { teamId, gpu } : { teamId }
});

const rooms = (userId: string) =>
	sql`select b.gpu_pci_id, b.label from box b where b.user_id = ${userId} and b.time_deleted is null`;

afterEach(() => {
	globalThis.fetch = realFetch;
	Polar.reset();
});

afterAll(async () => {
	await sql`delete from checkout_room where team_id in (select id from team where owner_id = any(${createdUserIds}))`;
	await sql`delete from box where user_id = any(${createdUserIds})`;
	await sql`delete from install_token where created_by_user_id = any(${createdUserIds})`;
	await sql`delete from machine where owner_user_id = any(${createdUserIds})`;
	await sql`delete from organisation where id = any(${createdOrgIds})`;
	await sql`delete from "user" where id = any(${createdUserIds})`;
});

describe('POST /billing/checkout with a GPU', () => {
	test('the model travels to the provider as checkout metadata', async () => {
		await fleet([[V710], [H100]]);
		const p = await person('co-meta');
		const sent = polarCheckout();
		const res = await app.request('/billing/checkout', {
			method: 'POST',
			headers: p.headers,
			body: JSON.stringify({ gpu: H100.model })
		});
		// The stand-in's reply is not a full checkout, so the SDK may refuse
		// to parse it; what matters here is what was sent.
		void res;
		expect(sent[0].metadata).toEqual({ teamId: p.owner.teamId, gpu: H100.model });
	});

	test('no gpu leaves the metadata as it was', async () => {
		await fleet([[V710]]);
		const p = await person('co-plain');
		const sent = polarCheckout();
		const res = await app.request('/billing/checkout', {
			method: 'POST',
			headers: p.headers,
			body: JSON.stringify({})
		});
		void res;
		expect(sent[0].metadata).toEqual({ teamId: p.owner.teamId });
	});

	test('a model the fleet does not have is refused, and nothing reaches the provider', async () => {
		await fleet([[V710]]);
		const p = await person('co-unknown');
		const sent = polarCheckout();
		const res = await app.request('/billing/checkout', {
			method: 'POST',
			headers: p.headers,
			body: JSON.stringify({ gpu: 'Imaginary 9000' })
		});
		expect(res.status).toBe(400);
		expect(sent).toHaveLength(0);
	});
});

describe('the webhook makes the room that was paid for', () => {
	test('a paid subscription with a gpu creates a room on that model', async () => {
		await fleet([[V710], [H100]]);
		const p = await person('wh-room');
		const res = await deliver('subscription.active', paid(p.owner.teamId, 'sub_wh_room', H100.model));
		expect(res.status).toBe(200);
		const made = await rooms(p.owner.userId);
		expect(made.map((r) => [r.gpu_pci_id, r.label])).toEqual([[H100.pciId, H100.model]]);
		const [row] = await sql`select substituted, placed_model from checkout_room where subscription_id = 'sub_wh_room'`;
		expect(row).toMatchObject({ substituted: false, placed_model: H100.model });
	});

	test('a redelivery, and the created event after the active one, add no second room', async () => {
		await fleet([[H100], [H100]]);
		const p = await person('wh-twice');
		const data = paid(p.owner.teamId, 'sub_wh_twice', H100.model);
		await deliver('subscription.created', data);
		await deliver('subscription.active', data);
		await deliver('subscription.active', data);
		expect(await rooms(p.owner.userId)).toHaveLength(1);
	});

	test('with the model taken, the closest free one of the same vendor is used and recorded', async () => {
		await fleet([[H100], [V710], [RX], [RTX]]);
		const taker = await person('wh-taker');
		await deliver('subscription.active', paid(taker.owner.teamId, 'sub_wh_taker', H100.model));
		const p = await person('wh-sub');
		// H100 is gone. Nvidia first, so the 4090 beats the closer-in-memory AMD cards.
		await deliver('subscription.active', paid(p.owner.teamId, 'sub_wh_sub', H100.model));
		const made = await rooms(p.owner.userId);
		expect(made.map((r) => r.gpu_pci_id)).toEqual([RTX.pciId]);
		const [row] = await sql`select substituted, requested_model, placed_model from checkout_room where subscription_id = 'sub_wh_sub'`;
		expect(row).toMatchObject({
			substituted: true,
			requested_model: H100.model,
			placed_model: RTX.model
		});
	});

	test('with nothing free, no room is made, the plan is still applied, and a retry stays quiet', async () => {
		await fleet([[V710]]);
		const taker = await person('wh-none-taker');
		await deliver('subscription.active', paid(taker.owner.teamId, 'sub_wh_nt', V710.model));
		const p = await person('wh-none');
		const data = paid(p.owner.teamId, 'sub_wh_none', V710.model);
		expect((await deliver('subscription.active', data)).status).toBe(200);
		expect(await rooms(p.owner.userId)).toHaveLength(0);
		const [team] = await sql`select plan from team where id = ${p.owner.teamId}`;
		expect(team!.plan).toBe('paid');
		await deliver('subscription.active', data);
		expect(await rooms(p.owner.userId)).toHaveLength(0);
	});

	test('a paid subscription with no gpu creates nothing', async () => {
		await fleet([[V710]]);
		const p = await person('wh-nogpu');
		await deliver('subscription.active', paid(p.owner.teamId, 'sub_wh_nogpu'));
		expect(await rooms(p.owner.userId)).toHaveLength(0);
	});
});
