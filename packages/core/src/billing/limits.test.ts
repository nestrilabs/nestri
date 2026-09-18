import { afterEach, describe, expect, test } from 'bun:test';

import { Env } from '../env.js';
import { Limits } from './limits.js';
import { Window } from './window.js';

const HOUR = 60 * 60;

/** Allowances in hours, which is how anybody actually reasons about them. */
function hours(fiveHour: number, sevenDay: number, thirtyDay: number) {
	return {
		fiveHour: fiveHour * HOUR,
		sevenDay: sevenDay * HOUR,
		thirtyDay: thirtyDay * HOUR
	};
}

afterEach(() => {
	Env.init({});
	Limits.reset();
});

describe('The floor: one uninterrupted session must never hit a wall', () => {
	test('an allowance at or below its own window is refused', () => {
		// A rolling window means a single continuous session asymptotes at
		// exactly the window length. So an allowance of five hours over a
		// five-hour window is a wall that someone playing alone will meet, and
		// meeting it is the one outcome this model may not produce.
		expect(() => Limits.check(hours(5, 300, 1000), 'free')).toThrow(/must exceed the window/);
		expect(() => Limits.check(hours(4, 300, 1000), 'free')).toThrow(/5-hour/);
		expect(() => Limits.check(hours(10, 168, 1000), 'free')).toThrow(/7-day/);
		expect(() => Limits.check(hours(10, 300, 720), 'free')).toThrow(/30-day/);
	});

	test('just above the window is accepted, because the rule is the floor', () => {
		// Deliberately close to every bound at once: each allowance barely
		// clears its own window, and each still sits under what the shorter
		// window permits (170h of weekly is under 33.6 x 5.5h = 184.8h; 725h of
		// monthly is under 4.29 x 170h = 728.6h). A set this tight is legal and
		// miserable, which is the point — the rules bound the space, they do not
		// choose within it.
		expect(() => Limits.check(hours(5.5, 170, 725), 'free')).not.toThrow();
	});

	test('the floors are the window lengths, stated in seconds', () => {
		// Spelled out so the relationship is visible rather than implied: the
		// floor is not a chosen number, it is the window.
		expect(Window.FIVE_HOURS).toBe(5 * HOUR);
		expect(Window.SEVEN_DAYS).toBe(168 * HOUR);
		expect(Window.THIRTY_DAYS).toBe(720 * HOUR);
	});
});

describe('The nesting rule: every window has to bind', () => {
	test('a longer allowance the shorter window already caps is refused', () => {
		// The 5-hour window permits 10h per 5h sustained, which is 336h over a
		// week. A 7-day allowance of 400h could never be reached, so it would
		// read like a limit and never once fire.
		expect(() => Limits.check(hours(10, 400, 1000), 'free')).toThrow(/never be reached/);
		expect(() => Limits.check(hours(10, 300, 1400), 'free')).toThrow(/30-day/);
	});

	test('the ceiling is exclusive, because equality never binds either', () => {
		// 33.6 x 10h is exactly 336h; at exactly the ceiling the window fires
		// only in the limit, which is the same as not firing.
		expect(() => Limits.check(hours(10, 336, 1000), 'free')).toThrow(/never be reached/);
		expect(() => Limits.check(hours(10, 335, 1000), 'free')).not.toThrow();
	});

	test('the reference tier has to cost exactly one unit a second', () => {
		// The unit *is* a second of a reference session, so moving `sm` off 1
		// would silently redefine every allowance — the same stored number
		// would be a different number of hours.
		expect(() =>
			Limits.checkFactors({ size: { xs: 500, sm: 900, md: 2200, lg: 5000, xl: 12000 } })
		).toThrow(/reference tier/);
		expect(() => Limits.checkFactors(Limits.PLACEHOLDER.factors)).not.toThrow();
	});

	test('the placeholder set satisfies both rules', () => {
		// It is not a pricing decision, but it has to be a coherent one, or
		// nothing downstream can be tested against it.
		expect(() => Limits.validate(Limits.PLACEHOLDER)).not.toThrow();
	});
});

describe('Configuration', () => {
	test('unset takes the placeholder set', () => {
		Env.init({});
		Limits.reset();
		expect(Limits.get()).toEqual(Limits.PLACEHOLDER);
	});

	test('the environment overrides it, and is validated on the way in', () => {
		Env.init({
			BURN_LIMITS: JSON.stringify({
				free: hours(12, 350, 1200),
				paid: hours(40, 1200, 4000),
				factors: Limits.PLACEHOLDER.factors
			})
		});
		Limits.reset();
		expect(Limits.get().free.fiveHour).toBe(12 * HOUR);
	});

	test('a configured set that would not bind is refused rather than used', () => {
		// The whole reason the check is code: these get retuned by whoever is
		// closest to the burn data, and a set that quietly stops binding is not
		// visible from the numbers.
		Env.init({
			BURN_LIMITS: JSON.stringify({
				free: hours(10, 400, 1000),
				paid: hours(30, 900, 3000),
				factors: Limits.PLACEHOLDER.factors
			})
		});
		Limits.reset();
		expect(() => Limits.get()).toThrow(/never be reached/);
	});

	test('malformed JSON is refused, not ignored', () => {
		Env.init({ BURN_LIMITS: '{not json' });
		Limits.reset();
		expect(() => Limits.get()).toThrow(/not valid JSON/);
	});

	test('anything that is not the paid plan gets the free allowance', () => {
		Env.init({});
		Limits.reset();
		for (const plan of ['free', null, undefined, 'something-we-retired']) {
			expect(Limits.forPlan(plan)).toEqual(Limits.PLACEHOLDER.free);
		}
		expect(Limits.forPlan('paid')).toEqual(Limits.PLACEHOLDER.paid);
	});
});

describe('What the placeholder set actually means', () => {
	// These are the sentences the numbers are supposed to say. If a retune
	// breaks one, the retune changed the product and should say so.
	const free = Limits.PLACEHOLDER.free;

	test('one session running continuously never exhausts any window', () => {
		for (const window of Window.ALL) {
			// One session burns one unit per second, so over any window it has
			// spent exactly the window length.
			const state = Window.analyze({
				allowance: free[window.key],
				windowSeconds: window.seconds,
				usage: window.seconds,
				timeUpdated: new Date()
			});
			expect(state.exhausted).toBe(false);
		}
	});

	test('two at once bites, and the five-hour window bites first', () => {
		const now = new Date();
		const twoForFiveHours = 2 * Window.FIVE_HOURS;
		expect(
			Window.analyze({
				allowance: free.fiveHour,
				windowSeconds: Window.FIVE_HOURS,
				usage: twoForFiveHours,
				timeUpdated: now
			}).exhausted
		).toBe(true);

		// The same burn is nowhere near the weekly allowance, which is what
		// makes the three windows do different jobs rather than one job thrice.
		expect(
			Window.analyze({
				allowance: free.sevenDay,
				windowSeconds: Window.SEVEN_DAYS,
				usage: twoForFiveHours,
				timeUpdated: now
			}).exhausted
		).toBe(false);
	});
});
