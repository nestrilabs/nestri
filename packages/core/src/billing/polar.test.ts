import { afterEach, describe, expect, test } from 'bun:test';

import { Env } from '../env.js';
import { Polar } from './polar.js';

afterEach(() => {
	Env.init({});
	Polar.reset();
});

describe('What an event means for access', () => {
	test('a live subscription is paid', () => {
		for (const type of [
			'subscription.created',
			'subscription.active',
			'subscription.updated',
			'subscription.uncanceled'
		]) {
			expect(Polar.standingFor(type)).toEqual({ plan: 'paid', status: 'active' });
		}
	});

	test('cancelling keeps the plan until the period is actually over', () => {
		// They paid to the end of the period. Turning them off the moment they
		// click cancel is taking something they bought.
		expect(Polar.standingFor('subscription.canceled')).toEqual({
			plan: 'paid',
			status: 'canceled'
		});
	});

	test('a failed card keeps the plan while it is being retried', () => {
		// A card that failed may yet work, and a retry cycle that ends in
		// payment should not have cost them access in the middle of it.
		expect(Polar.standingFor('subscription.past_due')).toEqual({
			plan: 'paid',
			status: 'past_due'
		});
	});

	test('revoked is the one that takes it away', () => {
		// The provider saying the period is over and unpaid, which is the only
		// moment there is nothing left that was paid for.
		expect(Polar.standingFor('subscription.revoked')).toEqual({
			plan: 'free',
			status: 'revoked'
		});
	});

	test('an unrecognised event changes nothing', () => {
		// New types get added by people who do not know what we do with them. A
		// default that moved somebody's plan would eventually cancel an account
		// nobody cancelled.
		for (const type of [
			'subscription.something_new',
			'order.created',
			'benefit.granted',
			'',
			'customer.updated'
		]) {
			expect(Polar.standingFor(type)).toBeNull();
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
		Env.init({ POLAR_ACCESS_TOKEN: 'polar_at_notreal' });
		Polar.reset();
		expect(Polar.configured()).toBe(false);
	});

	test('both together is configured', () => {
		Env.init({ POLAR_ACCESS_TOKEN: 'polar_at_notreal', POLAR_PRODUCT_ID: 'prod_notreal' });
		Polar.reset();
		expect(Polar.configured()).toBe(true);
	});
});

describe('Webhooks', () => {
	test('a body that is not signed is refused', () => {
		Env.init({
			POLAR_ACCESS_TOKEN: 'polar_at_notreal',
			POLAR_PRODUCT_ID: 'prod_notreal',
			POLAR_WEBHOOK_SECRET: 'whsec_notreal'
		});
		Polar.reset();
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
		Env.init({ POLAR_ACCESS_TOKEN: 'polar_at_notreal', POLAR_PRODUCT_ID: 'prod_notreal' });
		Polar.reset();
		expect(() => Polar.receive({ body: '{}', headers: {} })).toThrow(/not configured/);
	});
});
