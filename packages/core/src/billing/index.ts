import z from 'zod';

import { Box } from '../box/index.js';
import { ErrorCodes, VisibleError } from '../error.js';
import { fn } from '../fn.js';
import { Machine } from '../machine/index.js';
import { Team } from '../team/index.js';
import { Burn } from './burn.js';
import { Limits } from './limits.js';
import { Window } from './window.js';

/**
 * Whether a run may start, and what it will cost to have started it.
 *
 * The one rule this must never break: **a limit refuses the next run, it never
 * stops one already going.** Someone losing a session mid-game to a meter does
 * not come back, and no amount of correct arithmetic makes that a good trade.
 * So everything here is asked before a run begins and never again.
 */
export namespace Billing {
	export const WindowState = Window.State.extend({
		window: z.enum(['fiveHour', 'sevenDay', 'thirtyDay']),
		label: z.string()
	});

	export const State = z.object({
		teamId: z.string(),
		plan: z.string(),
		/** True when any window is spent. */
		exhausted: z.boolean(),
		/**
		 * What the account is spending per second right now, times a thousand,
		 * and what it would spend with one more run.
		 *
		 * Both, because the rule is that a cost is shown *before* it is
		 * incurred: a person about to start a third session needs to be told
		 * what that does to the rate while they can still not do it.
		 */
		rateMilli: z.number().int(),
		rateMilliIfOneMore: z.number().int(),
		windows: z.array(WindowState)
	});

	export type State = z.infer<typeof State>;

	/**
	 * The team that pays for a box.
	 *
	 * A box runs on a host, and the host says who owns it. Fleet hardware
	 * belongs to an organisation, which is not a billing subject — nothing is
	 * placed there yet, and when it is, what grants it is a plan rather than
	 * this lookup.
	 */
	export const teamForBox = fn(z.string(), async (boxId) => {
		const box = await Box.fromID(boxId);
		if (!box) {
			return null;
		}
		const machine = await Machine.fromID(box.machineId);
		if (!machine?.teamId) {
			return null;
		}
		return {
			teamId: machine.teamId,
			tier: box.tier as Burn.Tier,
			// Whose hardware decides the cost basis, and the machine is the only
			// thing that knows. A host an organisation owns is ours to pay for;
			// anything else is the caller's own card.
			hostClass: (machine.organisationId ? 'fleet' : 'byo') as Burn.HostClass
		};
	});

	/** Where a team stands, in every window, with the rates to show beside it. */
	export const state = fn(
		z.object({
			teamId: z.string(),
			/** The run being considered, so "one more" can be costed honestly. */
			nextTier: Burn.Tier.optional(),
			nextHostClass: Burn.HostClass.optional()
		}),
		async (input): Promise<State> => {
			const teamId = input.teamId;
			const team = await Team.fromID(teamId);
			const plan = team?.plan ?? 'free';
			const allowances = Limits.forPlan(plan);
			const counters = await Burn.counters(teamId);
			const open = await Burn.openSegments(teamId);

			const windows = Window.ALL.map((window) => {
				const usage = counters ? Number(counters[`${window.key}Usage`] ?? 0) : 0;
				const at = counters ? (counters[`${window.key}At`] ?? null) : null;
				return {
					window: window.key,
					label: window.label,
					...Window.analyze({
						allowance: allowances[window.key],
						windowSeconds: window.seconds,
						usage,
						timeUpdated: at
					})
				};
			});

			// The account's total is the sum of what each run costs, not a count
			// times one rate: an `xl` run and an `xs` one alongside it are not
			// two of anything. Concurrency shows up here, as there being more to
			// add, rather than as a multiplier on any of them.
			const rateMilli = open.reduce((total, segment) => total + segment.rateMilli, 0);
			const next = Burn.baseRateMilli({
				tier: input.nextTier ?? 'sm',
				hostClass: input.nextHostClass ?? 'byo'
			});

			return {
				teamId,
				plan,
				exhausted: windows.some((w) => w.exhausted),
				rateMilli,
				rateMilliIfOneMore: rateMilli + next,
				windows
			};
		}
	);

	/**
	 * Refuse a new run when any window is spent.
	 *
	 * Every window is checked, not the shortest: they protect different things
	 * over different spans, and a set where only one could ever fire is a set
	 * with two decorative numbers in it.
	 *
	 * The refusal names the window and when it clears, because a limit a person
	 * cannot plan around is the one they resent. `QUOTA_EXCEEDED` maps to 429,
	 * which is the honest status — this is a rate limit the customer experiences
	 * as a budget, and it will succeed later without anything changing.
	 */
	export const assertMayStart = fn(
		z.object({
			teamId: z.string(),
			nextTier: Burn.Tier.optional(),
			nextHostClass: Burn.HostClass.optional()
		}),
		async (input) => {
			const current = await state(input);
			const spent = current.windows.find((w) => w.exhausted);
			if (!spent) {
				return current;
			}
			const minutes = Math.ceil(spent.resetInSec / 60);
			throw new VisibleError(
				'rate_limit',
				ErrorCodes.RateLimit.QUOTA_EXCEEDED,
				`Your ${spent.label} allowance is spent. It clears in about ${minutes} minute${minutes === 1 ? '' : 's'}. Runs already going are not affected.`
			);
		}
	);
}
