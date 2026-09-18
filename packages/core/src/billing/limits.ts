import z from 'zod';

import { Env } from '../env.js';
import { ErrorCodes, VisibleError } from '../error.js';
import { memo } from '../utils/memo.js';
import { Window } from './window.js';

/**
 * How much burn a plan is allowed, per window.
 *
 * **The unit is one second of a reference session** — the baseline size, on the
 * baseline card, running alone, on hardware we own. Every factor is a multiple
 * of that, so an allowance is measured in *time* and a bar can print
 * `6h 20m of 12h` from the stored number instead of converting into it.
 * Integers throughout; burn is never a float.
 *
 * On a caller's own hardware the size and hardware factors are 1, because what
 * they price — a share of a card we paid for — is not being spent. Burn there
 * is duration multiplied by how much is running at once, and nothing about
 * their GPU enters into it. Nothing is ever measured on somebody's machine.
 *
 * **Configuration, not constants.** These numbers are not settled and will be
 * retuned against real burn far more often than this code changes. A rate that
 * needs a deploy is a rate that stays wrong for a week, so they are read from
 * the environment and validated at read time.
 */
export namespace Limits {
	const Allowances = z.object({
		fiveHour: z.number().int().positive(),
		sevenDay: z.number().int().positive(),
		thirtyDay: z.number().int().positive()
	});

	export type Allowances = z.infer<typeof Allowances>;

	/**
	 * What a size tier costs per second, times a thousand, on our own hardware.
	 *
	 * A tier buys a share of a card, so a bigger one spends more of something
	 * we paid for. These must be **superlinear in that share**: a small title
	 * asked to run at the top of the ladder has to cost what a whole card
	 * costs, or the ladder is gamed and the density that makes any of this
	 * priceable is theoretical.
	 *
	 * They do not apply on a caller's own hardware. See {@link Factors}.
	 */
	const SizeFactors = z.object({
		xs: z.number().int().positive(),
		sm: z.number().int().positive(),
		md: z.number().int().positive(),
		lg: z.number().int().positive(),
		xl: z.number().int().positive()
	});

	/**
	 * How much a running session costs per second, before concurrency.
	 *
	 * **Only on hardware we own.** The size factor prices a share of a card we
	 * bought; on somebody else's card there is no such share being spent, so a
	 * session there costs one unit a second whatever tier it asked for. Charging
	 * more for taking more of their own GPU would be a tax on hardware they paid
	 * for, which is the complaint this whole model is shaped to avoid.
	 *
	 * There is no hardware factor here yet, and its absence is deliberate rather
	 * than an oversight: nothing records which card a host has, so a table keyed
	 * on a model would be keyed on nothing. A faster card should cost more, and
	 * that starts with a column, not a number.
	 */
	export const Factors = z.object({
		size: SizeFactors
	});

	export type Factors = z.infer<typeof Factors>;

	export const Config = z.object({
		free: Allowances,
		paid: Allowances,
		factors: Factors
	});

	export type Config = z.infer<typeof Config>;

	/**
	 * Placeholder numbers, and deliberately labelled as such.
	 *
	 * They satisfy every rule {@link check} enforces, so the mechanism runs and
	 * can be tested end to end, and they are not a pricing decision. The free
	 * set says "one box around the clock, with room to double up now and then";
	 * the paid set is the same shape, larger. Both want replacing with numbers
	 * chosen against measured burn.
	 */
	export const PLACEHOLDER: Config = {
		free: {
			fiveHour: 10 * 60 * 60,
			sevenDay: 300 * 60 * 60,
			thirtyDay: 1000 * 60 * 60
		},
		paid: {
			fiveHour: 30 * 60 * 60,
			sevenDay: 900 * 60 * 60,
			thirtyDay: 3000 * 60 * 60
		},
		// Superlinear, and no more principled than that. `sm` is the reference
		// and is 1 by definition; the rest roughly double per step so the shape
		// is visible in tests. Real values come from what a card-hour costs us
		// divided by the share a tier holds.
		factors: {
			size: { xs: 500, sm: 1000, md: 2200, lg: 5000, xl: 12000 }
		}
	};

	/**
	 * The two rules that make a set of allowances mean anything.
	 *
	 * **A window's allowance must exceed the window itself.** Because the
	 * windows roll, one continuously-running session does not creep — it
	 * asymptotes at exactly the window length and stays there. So an allowance
	 * at or below its own window is one where a single uninterrupted session
	 * hits a wall, which is the one outcome the model may not produce: someone
	 * playing alone on hardware they own must never be stopped.
	 *
	 * **Each longer window must be smaller than what the shorter one already
	 * permits.** Sustained burn allowed by a window is `allowance ÷ window` per
	 * second, so a longer allowance above `allowance × (longer ÷ shorter)` can
	 * never be reached and is decoration — a number that looks like a limit,
	 * reads like a promise, and never fires.
	 *
	 * Both are cheap, and checking them here rather than in somebody's head is
	 * the point: these get retuned by whoever is closest to the burn data, and
	 * a set that quietly stops binding is not visible from the numbers.
	 */
	export function check(allowances: Allowances, plan: string): void {
		for (const window of Window.ALL) {
			const allowance = allowances[window.key];
			if (allowance <= window.seconds) {
				throw new VisibleError(
					'internal',
					ErrorCodes.Server.INTERNAL_ERROR,
					`${plan}: the ${window.label} allowance (${allowance}s) must exceed the window itself (${window.seconds}s), or one uninterrupted session hits a wall`
				);
			}
		}

		for (let i = 1; i < Window.ALL.length; i++) {
			const shorter = Window.ALL[i - 1]!;
			const longer = Window.ALL[i]!;
			const ceiling = (allowances[shorter.key] * longer.seconds) / shorter.seconds;
			if (allowances[longer.key] >= ceiling) {
				throw new VisibleError(
					'internal',
					ErrorCodes.Server.INTERNAL_ERROR,
					`${plan}: the ${longer.label} allowance (${allowances[longer.key]}s) can never be reached, because the ${shorter.label} window already caps it at ${Math.floor(ceiling)}s — it would never bind`
				);
			}
		}
	}

	/**
	 * The reference tier costs exactly one unit a second, by definition.
	 *
	 * The unit *is* a second of a reference session, so a size factor that made
	 * `sm` anything other than 1 would silently redefine what every allowance
	 * means — the same stored number would be a different number of hours.
	 */
	export function checkFactors(factors: Factors): void {
		if (factors.size.sm !== 1000) {
			throw new VisibleError(
				'internal',
				ErrorCodes.Server.INTERNAL_ERROR,
				`the reference tier must cost exactly one unit a second (1000), not ${factors.size.sm} \u2014 it is what every allowance is denominated in`
			);
		}
	}

	export function validate(config: unknown): Config {
		const parsed = Config.parse(config);
		check(parsed.free, 'free');
		check(parsed.paid, 'paid');
		checkFactors(parsed.factors);
		return parsed;
	}

	const _get = memo((): Config => {
		const raw = Env.get().BURN_LIMITS;
		if (!raw) {
			return validate(PLACEHOLDER);
		}
		let parsed: unknown;
		try {
			parsed = JSON.parse(raw);
		} catch {
			throw new VisibleError(
				'internal',
				ErrorCodes.Server.INTERNAL_ERROR,
				'BURN_LIMITS is not valid JSON'
			);
		}
		return validate(parsed);
	});

	export function get(): Config {
		return _get();
	}

	/** Reset the memo. Tests change the environment between cases. */
	export function reset(): void {
		_get.reset();
	}

	/** The allowances a plan gets. Anything not `paid` is free. */
	export function forPlan(plan: string | null | undefined): Allowances {
		const config = get();
		return plan === 'paid' ? config.paid : config.free;
	}
}
