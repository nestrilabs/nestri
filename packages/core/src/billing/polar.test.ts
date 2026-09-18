import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { Env } from '../env.js';
import { Polar } from './polar.js';

const PAID = 'prod_paid_notreal';
const FREE = 'prod_free_notreal';

function configure(extra: Record<string, string> = {}) {
	Env.init({
		POLAR_ACCESS_TOKEN: 'polar_oat_notreal',
		POLAR_PRODUCT_ID: PAID,
		POLAR_FREE_PRODUCT_ID: FREE,
		...extra
	});
	Polar.reset();
}

beforeEach(() => configure());

afterEach(() => {
	Env.init({});
	Polar.reset();
});

describe('Which plan a subscription is', () => {
	test('the product decides it, not the event', () => {
		// Free is a real subscription here, so it announces itself with the same
		// `subscription.created` a paid one does. Reading the type alone would
		// put every new signup on the paid allowance.
		expect(Polar.standingFor('subscription.created', FREE)).toEqual({
			plan: 'free',
			status: 'active'
		});
		expect(Polar.standingFor('subscription.created', PAID)).toEqual({
			plan: 'paid',
			status: 'active'
		});
	});

	test('a product we do not sell changes nothing', () => {
		// Somebody selling something else through the same account must not be
		// able to change what a team may run by doing so.
		expect(Polar.standingFor('subscription.active', 'prod_somethingelse')).toBeNull();
		expect(Polar.standingFor('subscription.active', null)).toBeNull();
	});
});

describe('What an event means for access', () => {
	test('a live subscription keeps its plan', () => {
		for (const type of [
			'subscription.created',
			'subscription.active',
			'subscription.updated',
			'subscription.uncanceled'
		]) {
			expect(Polar.standingFor(type, PAID)).toEqual({ plan: 'paid', status: 'active' });
		}
	});

	test('cancelling keeps the plan until the period is actually over', () => {
		// They paid to the end of the period. Turning them off the moment they
		// click cancel is taking something they bought.
		expect(Polar.standingFor('subscription.canceled', PAID)).toEqual({
			plan: 'paid',
			status: 'canceled'
		});
	});

	test('a failed card keeps the plan while it is being retried', () => {
		// A card that failed may yet work, and a retry cycle that ends in
		// payment should not have cost them access in the middle of it.
		expect(Polar.standingFor('subscription.past_due', PAID)).toEqual({
			plan: 'paid',
			status: 'past_due'
		});
	});

	test('revoked drops to free, whatever it was before', () => {
		// The provider saying the period is over and unpaid, which is the only
		// moment there is nothing left that was paid for.
		expect(Polar.standingFor('subscription.revoked', PAID)).toEqual({
			plan: 'free',
			status: 'revoked'
		});
		expect(Polar.standingFor('subscription.revoked', FREE)).toEqual({
			plan: 'free',
			status: 'revoked'
		});
	});

	test('an unrecognised event changes nothing', () => {
		// New types get added by people who do not know what we do with them. A
		// default that moved somebody's plan would eventually cancel an account
		// nobody cancelled.
		for (const type of ['subscription.something_new', 'order.created', '', 'customer.updated']) {
			expect(Polar.standingFor(type, PAID)).toBeNull();
		}
	});
});

describe('Configuration', () => {
	test('unconfigured is a state, not a crash', () => {
		Env.init({});
		Polar.reset();
		expect(Polar.configured()).toBe(false);
	});

	test('a token without a product is still not configured', () => {
		// Half-configured is the dangerous one: a checkout with no product to
		// sell would fail at the provider, after the person clicked pay.
		Env.init({ POLAR_ACCESS_TOKEN: 'polar_oat_notreal' });
		Polar.reset();
		expect(Polar.configured()).toBe(false);
	});

	test('both together is configured', () => {
		expect(Polar.configured()).toBe(true);
	});
});

describe('Webhooks', () => {
	test('a body that is not signed is refused', () => {
		configure({ POLAR_WEBHOOK_SECRET: 'whsec_notreal' });
		expect(() =>
			Polar.receive({
				body: JSON.stringify({ type: 'subscription.active', data: {} }),
				headers: { 'webhook-id': 'x', 'webhook-timestamp': '1', 'webhook-signature': 'v1,no' }
			})
		).toThrow();
	});

	test('no secret configured is a refusal, never an unchecked delivery', () => {
		// This route has no session in front of it. If the secret is missing the
		// only safe answer is to refuse, because accepting would mean anybody
		// who knows the URL can set anybody's plan.
		expect(() => Polar.receive({ body: '{}', headers: {} })).toThrow(/not configured/);
	});
});
