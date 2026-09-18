import { and, eq, isNull, sql, type SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import z from 'zod';

import { Database } from '../db/index.js';
import { fn } from '../fn.js';
import { Identifier } from '../id.js';
import { BurnCounterTable, BurnSegmentTable } from './burn.sql.js';
import { Limits } from './limits.js';
import { Window } from './window.js';

/**
 * Recording what a team spends, as segments at a constant rate.
 *
 * The rate of a run is knowable before it starts — that is what lets somebody
 * be told the cost before they commit — but it does not stay fixed, because a
 * second run changes what the account spends per second while the first is
 * still going. So burn is recorded as stretches at one rate: opened when the
 * rate becomes true, closed when it stops being, never edited after.
 *
 * Closing a segment is what moves burn into the counters, so a long run lands
 * incrementally rather than all at the end. That matters for more than
 * freshness: burn that only arrives when a session stops is burn that cannot
 * stop the *next* session from starting, and a bar that does not move while
 * something is running is a bar nobody believes.
 */
export namespace Burn {
	/** Rates are scaled by this so fractional factors stay integers. */
	export const SCALE = 1000;

	/** Whose hardware a run is on, which is what decides the cost basis. */
	export const HostClass = z.enum(['byo', 'fleet']);
	export type HostClass = z.infer<typeof HostClass>;

	export const Tier = z.enum(['xs', 'sm', 'md', 'lg', 'xl']);
	export type Tier = z.infer<typeof Tier>;

	/**
	 * What one run costs per second, before anything else is running.
	 *
	 * **On our own hardware the tier decides it**, because a tier buys a share
	 * of a card we paid for and a bigger share is more of something real being
	 * spent. On the caller's own hardware it does not: there is no share of a
	 * card of ours in play, so a run costs one unit a second whatever size it
	 * asked for. Charging somebody more for taking more of their own GPU is a
	 * tax on hardware they bought, and avoiding that is most of the point.
	 *
	 * Note what is *not* here: the number of other runs. Concurrency is on the
	 * account's total, not on any one run — two deadline guarantees cost twice
	 * one, so two runs cost the sum of their two rates and neither of them gets
	 * more expensive because the other started. That is why this rate is fixed
	 * for a run's whole life, and why a sibling starting does not have to
	 * rewrite anything.
	 */
	export const baseRateMilli = fn(
		z.object({ tier: Tier, hostClass: HostClass }),
		(input): number => {
			if (input.hostClass === 'byo') {
				return SCALE;
			}
			return Limits.get().factors.size[input.tier];
		}
	);

	/** Burn from one closed stretch, in whole reference-seconds. */
	export function amountFor(seconds: number, rateMilli: number): number {
		return Math.floor((Math.max(0, seconds) * rateMilli) / SCALE);
	}

	/**
	 * Add to a window's total, or start it again, in one statement.
	 *
	 * The `CASE` is the whole staleness rule on the write side: if the stamp is
	 * still inside the window the amount joins the total and the stamp is left
	 * where it was; if it has rolled out, the total *becomes* this amount and
	 * the stamp moves to now. Reading and then deciding would be two statements
	 * with a gap in between, and the gap is where a concurrent tick doubles or
	 * vanishes.
	 */
	function windowSet(
		usageColumn: PgColumn,
		atColumn: PgColumn,
		windowSeconds: number,
		amount: number
	): { usage: SQL; at: SQL } {
		const fresh = sql`${atColumn} >= now() - make_interval(secs => ${windowSeconds})`;
		return {
			usage: sql`case when ${fresh} then ${usageColumn} + ${amount} else ${amount} end`,
			at: sql`case when ${fresh} then ${atColumn} else now() end`
		};
	}

	/** Apply one amount of burn to all three of a team's windows. */
	export const record = fn(
		z.object({ teamId: z.string(), amount: z.number().int().nonnegative() }),
		async (input) => {
			if (input.amount === 0) {
				return;
			}
			const five = windowSet(
				BurnCounterTable.fiveHourUsage,
				BurnCounterTable.fiveHourAt,
				Window.FIVE_HOURS,
				input.amount
			);
			const seven = windowSet(
				BurnCounterTable.sevenDayUsage,
				BurnCounterTable.sevenDayAt,
				Window.SEVEN_DAYS,
				input.amount
			);
			const thirty = windowSet(
				BurnCounterTable.thirtyDayUsage,
				BurnCounterTable.thirtyDayAt,
				Window.THIRTY_DAYS,
				input.amount
			);

			await Database.use(async (tx) => {
				await tx
					.insert(BurnCounterTable)
					.values({
						id: Identifier.ascending('burnCounter'),
						teamId: input.teamId,
						fiveHourUsage: input.amount,
						fiveHourAt: sql`now()`,
						sevenDayUsage: input.amount,
						sevenDayAt: sql`now()`,
						thirtyDayUsage: input.amount,
						thirtyDayAt: sql`now()`
					})
					// The first tick for a team and the thousandth are the same
					// call. A read-then-insert would race two first ticks into two
					// rows, which the unique index would then refuse — turning an
					// ordinary heartbeat into an error.
					.onConflictDoUpdate({
						target: BurnCounterTable.teamId,
						set: {
							fiveHourUsage: five.usage,
							fiveHourAt: five.at,
							sevenDayUsage: seven.usage,
							sevenDayAt: seven.at,
							thirtyDayUsage: thirty.usage,
							thirtyDayAt: thirty.at
						}
					});
			});
		}
	);

	/** A team's three totals, or nulls where nothing has been recorded. */
	export const counters = fn(z.string(), async (teamId) => {
		return Database.use(async (tx) => {
			return tx
				.select()
				.from(BurnCounterTable)
				.where(eq(BurnCounterTable.teamId, teamId))
				.then((rows) => rows.at(0) ?? null);
		});
	});

	/** Every run currently accruing for a team. */
	export const openSegments = fn(z.string(), async (teamId) => {
		return Database.use(async (tx) => {
			return tx
				.select()
				.from(BurnSegmentTable)
				.where(and(eq(BurnSegmentTable.teamId, teamId), isNull(BurnSegmentTable.endedAt)))
				.orderBy(BurnSegmentTable.startedAt);
		});
	});

	/**
	 * Close every open stretch for a team and start new ones at the new rate.
	 *
	 * Called whenever the number of running sessions changes, and periodically
	 * while they run so the counters do not lag a long session. It is one
	 * operation rather than a close and an open, because between them the
	 * account would be spending nothing — and a tick that lands in that gap
	 * would record a rate nobody was ever charged.
	 *
	 * Safe to call when nothing has changed: a segment closed and reopened at
	 * the same rate bills identically, it is just two rows instead of one.
	 */
	export const resegment = fn(
		z.object({ teamId: z.string(), at: z.date().optional() }),
		async (input) => {
			return Database.transaction(async (tx) => {
				const now = input.at ?? new Date();
				const open = await tx
					.select()
					.from(BurnSegmentTable)
					.where(and(eq(BurnSegmentTable.teamId, input.teamId), isNull(BurnSegmentTable.endedAt)));

				if (open.length === 0) {
					return 0;
				}

				let total = 0;
				for (const segment of open) {
					const seconds = Math.floor((now.getTime() - segment.startedAt.getTime()) / 1000);
					total += amountFor(seconds, segment.rateMilli);
				}

				await tx
					.update(BurnSegmentTable)
					.set({ endedAt: now })
					.where(and(eq(BurnSegmentTable.teamId, input.teamId), isNull(BurnSegmentTable.endedAt)));

				// Each run keeps its own rate. It is a property of what that run
				// is — its tier, and whose hardware it sits on — and none of that
				// changed because the clock ticked or a sibling appeared.
				// Recomputing a single shared rate here would quietly reprice an
				// `xl` run as whatever the last one to start was.
				await tx.insert(BurnSegmentTable).values(
					open.map((segment) => ({
						id: Identifier.ascending('burnSegment'),
						teamId: segment.teamId,
						sessionId: segment.sessionId,
						rateMilli: segment.rateMilli,
						startedAt: now
					}))
				);

				await record({ teamId: input.teamId, amount: total });
				return total;
			});
		}
	);

	/**
	 * Start accruing for a run.
	 *
	 * Existing runs are resegmented first, so their old rate is banked before
	 * the new count applies to anybody — otherwise the change would be
	 * backdated over time that was spent under the old one.
	 */
	export const start = fn(
		z.object({
			teamId: z.string(),
			sessionId: z.string(),
			tier: Tier,
			hostClass: HostClass,
			at: z.date().optional()
		}),
		async (input) => {
			return Database.transaction(async (tx) => {
				const now = input.at ?? new Date();
				// Bank what the runs already going have spent, so the moment this
				// one appears is a clean boundary in the record rather than a
				// point inside somebody else's open stretch.
				await resegment({ teamId: input.teamId, at: now });

				await tx.insert(BurnSegmentTable).values({
					id: Identifier.ascending('burnSegment'),
					teamId: input.teamId,
					sessionId: input.sessionId,
					rateMilli: baseRateMilli({ tier: input.tier, hostClass: input.hostClass }),
					startedAt: now
				});
			});
		}
	);

	/**
	 * Stop accruing for a run, banking what it spent.
	 *
	 * The remaining runs are resegmented afterwards, so they stop paying for a
	 * sibling that has gone. Idempotent: a run with nothing open is a run that
	 * already stopped, and saying so twice must not bill twice.
	 */
	export const stop = fn(
		z.object({ teamId: z.string(), sessionId: z.string(), at: z.date().optional() }),
		async (input) => {
			return Database.transaction(async (tx) => {
				const now = input.at ?? new Date();
				const closed = await tx
					.update(BurnSegmentTable)
					.set({ endedAt: now })
					.where(
						and(eq(BurnSegmentTable.sessionId, input.sessionId), isNull(BurnSegmentTable.endedAt))
					)
					.returning();

				let total = 0;
				for (const segment of closed) {
					const seconds = Math.floor((now.getTime() - segment.startedAt.getTime()) / 1000);
					total += amountFor(seconds, segment.rateMilli);
				}
				await record({ teamId: input.teamId, amount: total });
				await resegment({ teamId: input.teamId, at: now });
				return total;
			});
		}
	);
}
