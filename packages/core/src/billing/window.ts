import z from 'zod';

import { fn } from '../fn.js';

/**
 * Reading a rolling window, without a job that resets it.
 *
 * A counter is stored next to the time it was last written, and a counter
 * whose timestamp falls outside the current window simply **reads as zero**.
 * Nothing resets anything on a schedule: the reset is implied by the clock, so
 * there is no cron to misfire and no race between a reset and a concurrent
 * write. The same rule applied on the write side — increment if the stamp is
 * inside the window, otherwise start again from this amount — makes the whole
 * thing one statement.
 *
 * Everything here is pure. It takes numbers and gives an answer, which is what
 * lets the meter a person sees and the check that stops them be the same
 * arithmetic rather than two implementations that agree for now.
 */
export namespace Window {
	/** Seconds. Named so a caller cannot pass minutes by accident. */
	export const FIVE_HOURS = 5 * 60 * 60;
	export const SEVEN_DAYS = 7 * 24 * 60 * 60;
	export const THIRTY_DAYS = 30 * 24 * 60 * 60;

	/**
	 * The three, shortest first.
	 *
	 * Order is load-bearing: the nesting rule that keeps each allowance
	 * meaningful is stated between neighbours, and the bars are read top-down.
	 */
	export const ALL = [
		{ key: 'fiveHour' as const, seconds: FIVE_HOURS, label: '5-hour' },
		{ key: 'sevenDay' as const, seconds: SEVEN_DAYS, label: '7-day' },
		{ key: 'thirtyDay' as const, seconds: THIRTY_DAYS, label: '30-day' }
	];

	export type Key = (typeof ALL)[number]['key'];

	export const State = z.object({
		/** Whether a new run may start. A live one is never stopped by this. */
		exhausted: z.boolean(),
		/** Burn already spent in this window, after the staleness rule. */
		used: z.number().int(),
		/** The allowance it is spent against. Never reported without `used`. */
		allowance: z.number().int(),
		/** What is left, floored at zero — overrun is real but never negative. */
		remaining: z.number().int(),
		/**
		 * Whole percent used, 0–100.
		 *
		 * For the bar, and deliberately the same number the gate reads, so a
		 * full bar and a refusal cannot disagree.
		 */
		percent: z.number().int(),
		/** Seconds until this window has rolled clear of the current usage. */
		resetInSec: z.number().int()
	});

	export type State = z.infer<typeof State>;

	/**
	 * Where one window stands.
	 *
	 * `usage` and `timeUpdated` are the stored pair. A `timeUpdated` older than
	 * the window means everything recorded in it has rolled out of view, so the
	 * answer is a clean zero rather than a stale total — this is the staleness
	 * rule, and it is why nothing has to be reset.
	 */
	export const analyze = fn(
		z.object({
			allowance: z.number().int().nonnegative(),
			windowSeconds: z.number().int().positive(),
			usage: z.number().int().nonnegative(),
			/** Null when nothing has ever been recorded, which reads as zero. */
			timeUpdated: z.date().nullable(),
			/** Injected so the arithmetic is testable without waiting. */
			now: z.date().optional()
		}),
		(input): State => {
			const now = input.now ?? new Date();
			const windowMs = input.windowSeconds * 1000;
			const windowStart = now.getTime() - windowMs;

			// Rolled clear: the stored total describes a window that has passed.
			if (!input.timeUpdated || input.timeUpdated.getTime() < windowStart) {
				return {
					exhausted: false,
					used: 0,
					allowance: input.allowance,
					remaining: input.allowance,
					percent: 0,
					resetInSec: 0
				};
			}

			const used = input.usage;
			const remaining = Math.max(0, input.allowance - used);
			const percent =
				input.allowance === 0 ? 100 : Math.min(100, Math.floor((used / input.allowance) * 100));

			// When the last write rolls out of the window, this usage is gone.
			const clearsAt = input.timeUpdated.getTime() + windowMs;
			const resetInSec = Math.max(0, Math.ceil((clearsAt - now.getTime()) / 1000));

			return {
				exhausted: used >= input.allowance,
				used,
				allowance: input.allowance,
				remaining,
				percent,
				resetInSec
			};
		}
	);
}
