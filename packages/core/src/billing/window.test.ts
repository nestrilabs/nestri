import { describe, expect, test } from 'bun:test';

import { Window } from './window.js';

const HOUR = 60 * 60;
const NOW = new Date('2026-09-18T12:00:00.000Z');

function ago(seconds: number) {
	return new Date(NOW.getTime() - seconds * 1000);
}

function fiveHour(usage: number, timeUpdated: Date | null, allowance = 10 * HOUR) {
	return Window.analyze({
		allowance,
		windowSeconds: Window.FIVE_HOURS,
		usage,
		timeUpdated,
		now: NOW
	});
}

describe('The staleness rule', () => {
	test('a counter older than the window reads as zero', () => {
		// This is what replaces a reset job. Nothing has to run for the window
		// to roll clear, so there is no cron to misfire and no race between a
		// reset and a write landing at the same moment.
		const state = fiveHour(9 * HOUR, ago(Window.FIVE_HOURS + 1));
		expect(state.used).toBe(0);
		expect(state.percent).toBe(0);
		expect(state.exhausted).toBe(false);
		expect(state.remaining).toBe(10 * HOUR);
	});

	test('a counter inside the window is counted', () => {
		const state = fiveHour(9 * HOUR, ago(Window.FIVE_HOURS - 60));
		expect(state.used).toBe(9 * HOUR);
		expect(state.exhausted).toBe(false);
	});

	test('nothing ever recorded reads as zero rather than throwing', () => {
		expect(fiveHour(0, null).used).toBe(0);
	});

	test('the boundary belongs to the window, not outside it', () => {
		// Exactly one window old is the oldest moment still in view. Getting
		// this backwards would silently forgive a window's worth of burn.
		expect(fiveHour(9 * HOUR, ago(Window.FIVE_HOURS)).used).toBe(9 * HOUR);
	});
});

describe('Exhaustion', () => {
	test('at the allowance is exhausted, not just above it', () => {
		expect(fiveHour(10 * HOUR, NOW).exhausted).toBe(true);
		expect(fiveHour(10 * HOUR - 1, NOW).exhausted).toBe(false);
	});

	test('overrun is reported, but remaining never goes negative', () => {
		// A run is never stopped mid-session, so burn past the allowance is a
		// real and expected state — it just has nothing left to offer.
		const state = fiveHour(14 * HOUR, NOW);
		expect(state.used).toBe(14 * HOUR);
		expect(state.remaining).toBe(0);
		expect(state.percent).toBe(100);
	});

	test('a zero allowance is exhausted rather than dividing by zero', () => {
		const state = fiveHour(0, NOW, 0);
		expect(state.exhausted).toBe(true);
		expect(state.percent).toBe(100);
	});
});

describe('What the bar shows is what the gate reads', () => {
	test('the percent the bar draws is the same number the check uses', () => {
		// The complaint about usage limits is almost never the limit, it is
		// being surprised by it. One arithmetic means a full bar and a refusal
		// cannot disagree.
		const state = fiveHour(5 * HOUR, NOW);
		expect(state.percent).toBe(50);
		expect(state.exhausted).toBe(false);
		expect(state.remaining).toBe(5 * HOUR);
		expect(state.used + state.remaining).toBe(state.allowance);
	});

	test('percent floors rather than rounds, so it reads 99 until it is done', () => {
		expect(fiveHour(10 * HOUR - 1, NOW).percent).toBe(99);
	});

	test('reset counts from when the burn rolls out of view', () => {
		const state = fiveHour(3 * HOUR, ago(HOUR));
		expect(state.resetInSec).toBe(Window.FIVE_HOURS - HOUR);
	});

	test('a cleared window has nothing to wait for', () => {
		expect(fiveHour(9 * HOUR, ago(Window.FIVE_HOURS + 1)).resetInSec).toBe(0);
	});
});

describe('The three windows are the same arithmetic', () => {
	test('one function, parameterised by length', () => {
		// Their monthly window is calendar-anchored; ours rolls. Reaching for a
		// month-bounds helper here would be a subtle and expensive mistake.
		for (const window of Window.ALL) {
			const state = Window.analyze({
				allowance: 2 * window.seconds,
				windowSeconds: window.seconds,
				usage: window.seconds,
				timeUpdated: NOW,
				now: NOW
			});
			expect(state.percent).toBe(50);
			expect(state.exhausted).toBe(false);
		}
	});
});
