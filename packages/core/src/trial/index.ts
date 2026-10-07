import { and, count, eq, isNull, sql } from 'drizzle-orm';
import z from 'zod';

import { BoxTable } from '../box/box.sql.js';
import { Database } from '../db/index.js';
import { ErrorCodes, VisibleError } from '../error.js';
import { fn } from '../fn.js';
import { Identifier } from '../id.js';
import { MachineTable } from '../machine/machine.sql.js';
import { SessionTable } from '../session/session.sql.js';
import { TeamTable } from '../team/team.sql.js';
import { LinkedAccountTable } from '../user/linked-account.sql.js';
import { UserTable } from '../user/user.sql.js';
import { TrialClaimTable } from './trial.sql.js';

/**
 * The free weekend: play on rented GPUs without a plan, a little, at weekends.
 *
 * Three rules and nothing else:
 *
 * - **When.** Friday 00:00 to Monday 00:00, on the clock of the place the
 *   hardware is run from. Outside that, a trial run is refused, and one still
 *   going when it closes is stopped.
 * - **How much.** {@link HOURS} of live time per window, across every run.
 *   Unlike a plan's allowance, this one stops a run that reaches it: the
 *   trial is the hardware lent, not a budget being drawn down.
 * - **For how long.** Until {@link PAID_SEATS} teams pay for a plan. Then the
 *   hardware is theirs and the trial closes for everyone.
 *
 * Downloading a game is not playing it and is never refused here; only a run
 * is.
 */
export namespace Trial {
	export const HOURS = 2;
	export const PAID_SEATS = 5;
	export const ZONE = 'Europe/Helsinki';

	const SECONDS = HOURS * 3600;

	/**
	 * What time it is, for every rule here. Replaceable so a test can stand on
	 * a Saturday; nothing else has a reason to touch it.
	 */
	export let now = () => new Date();
	export function useClock(clock: () => Date) {
		now = clock;
	}

	/** A zone's UTC offset at one instant, in milliseconds. */
	function offsetMs(at: Date): number {
		const name = new Intl.DateTimeFormat('en-US', { timeZone: ZONE, timeZoneName: 'longOffset' })
			.formatToParts(at)
			.find((p) => p.type === 'timeZoneName')!.value;
		const m = /GMT([+-])(\d{2}):?(\d{2})?/.exec(name);
		if (!m) return 0;
		const sign = m[1] === '-' ? -1 : 1;
		return sign * (Number(m[2]) * 60 + Number(m[3] ?? 0)) * 60_000;
	}

	/** Midnight at the start of a calendar day in {@link ZONE}, as an instant. */
	function midnight(year: number, month: number, day: number): Date {
		const guess = Date.UTC(year, month - 1, day);
		// Twice, because the offset at the guess and at the answer can differ by
		// the hour a clock change moved.
		const once = guess - offsetMs(new Date(guess));
		return new Date(guess - offsetMs(new Date(once)));
	}

	/** The calendar day an instant falls on in {@link ZONE}, and its weekday (Mon 1 … Sun 7). */
	function localDay(at: Date) {
		const parts = Object.fromEntries(
			new Intl.DateTimeFormat('en-US', {
				timeZone: ZONE,
				year: 'numeric',
				month: 'numeric',
				day: 'numeric',
				weekday: 'short'
			})
				.formatToParts(at)
				.map((p) => [p.type, p.value])
		);
		const weekday = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(parts.weekday!) + 1;
		return {
			year: Number(parts.year),
			month: Number(parts.month),
			day: Number(parts.day),
			weekday
		};
	}

	function addDays(d: { year: number; month: number; day: number }, n: number) {
		const t = new Date(Date.UTC(d.year, d.month - 1, d.day + n));
		return { year: t.getUTCFullYear(), month: t.getUTCMonth() + 1, day: t.getUTCDate() };
	}

	export interface Window {
		/** Whether `at` is inside it. */
		open: boolean;
		/** The window `at` is in, or the next one. */
		start: Date;
		end: Date;
	}

	/** The weekend window an instant is in, or the next one if it is in none. */
	export function window(at: Date = now()): Window {
		const today = localDay(at);
		const sinceFriday = (today.weekday - 5 + 7) % 7; // Fri 0, Sat 1, Sun 2, Mon 3 …
		const open = sinceFriday <= 2;
		const friday = addDays(today, open ? -sinceFriday : 7 - sinceFriday);
		const monday = addDays(friday, 3);
		return {
			open,
			start: midnight(friday.year, friday.month, friday.day),
			end: midnight(monday.year, monday.month, monday.day)
		};
	}

	/** Whether the trial is still offered: fewer than {@link PAID_SEATS} teams pay. */
	export async function offered(): Promise<boolean> {
		const [row] = await Database.use((tx) =>
			tx
				.select({ paid: count() })
				.from(TeamTable)
				.where(and(eq(TeamTable.plan, 'paid'), isNull(TeamTable.timeDeleted)))
		);
		return (row?.paid ?? 0) < PAID_SEATS;
	}

	/** Live seconds of a person's trial runs inside `[start, end)`, up to `now`. */
	export async function usedSeconds(userId: string, w: Window, at: Date = now()) {
		const [row] = await Database.use((tx) =>
			tx
				.select({
					seconds: sql<string>`coalesce(sum(greatest(0, extract(epoch from
						least(coalesce(${SessionTable.timeStopped}, ${at.toISOString()}::timestamptz), ${w.end.toISOString()}::timestamptz)
						- greatest(${SessionTable.timeStarted}, ${w.start.toISOString()}::timestamptz)))), 0)`
				})
				.from(SessionTable)
				.innerJoin(BoxTable, eq(SessionTable.boxId, BoxTable.id))
				.where(
					and(
						eq(BoxTable.userId, userId),
						eq(SessionTable.trial, true),
						sql`${SessionTable.timeStarted} is not null`,
						isNull(SessionTable.timeDeleted)
					)
				)
		);
		return Math.floor(Number(row?.seconds ?? 0));
	}

	function when(at: Date): string {
		return new Intl.DateTimeFormat('en-GB', {
			timeZone: ZONE,
			weekday: 'long',
			hour: '2-digit',
			minute: '2-digit',
			timeZoneName: 'short'
		}).format(at);
	}

	/**
	 * Refuse a trial run that may not start, or record the claim and let it.
	 *
	 * The order is the order a person can act on: closed for everyone first,
	 * then "not you" (somebody already used this address or account), then
	 * "not now" (outside the window, or this window's hours are spent).
	 */
	export const assertMayStart = fn(
		z.object({
			teamId: z.string(),
			userId: z.string(),
			linkedAccountId: z.string(),
			now: z.date().optional()
		}),
		async (input) => {
			const at = input.now ?? now();
			if (!(await offered())) {
				throw new VisibleError(
					'forbidden',
					ErrorCodes.Permission.ACCOUNT_RESTRICTED,
					'The free weekend has closed: Nestri GPUs are now taken by paying teams. A plan gets you on.'
				);
			}

			await claim(input);

			const w = window(at);
			if (!w.open) {
				throw new VisibleError(
					'rate_limit',
					ErrorCodes.RateLimit.QUOTA_EXCEEDED,
					`Free play on Nestri GPUs is Friday to Sunday. The next window opens ${when(w.start)}.`
				);
			}
			if ((await usedSeconds(input.userId, w, at)) >= SECONDS) {
				const next = window(w.end);
				throw new VisibleError(
					'rate_limit',
					ErrorCodes.RateLimit.QUOTA_EXCEEDED,
					`Your ${HOURS} free hours this weekend are used. The next window opens ${when(next.start)}.`
				);
			}
		}
	);

	/**
	 * The team's claim, made on its first trial run.
	 *
	 * Checked by reading, then held by the unique indexes: two first runs in
	 * the same instant both read "unclaimed", and the second insert is refused
	 * with the same answer the read would have given.
	 */
	async function claim(input: { teamId: string; userId: string; linkedAccountId: string }) {
		const existing = await Database.use((tx) =>
			tx.select().from(TrialClaimTable).where(eq(TrialClaimTable.teamId, input.teamId))
		);
		if (existing.length > 0) return;

		const [person] = await Database.use((tx) =>
			tx.select({ email: UserTable.email }).from(UserTable).where(eq(UserTable.id, input.userId))
		);
		const [linked] = await Database.use((tx) =>
			tx
				.select({ steamId: LinkedAccountTable.providerAccountId })
				.from(LinkedAccountTable)
				.where(eq(LinkedAccountTable.id, input.linkedAccountId))
		);
		const email = person?.email?.trim().toLowerCase();
		if (!email || !linked) {
			throw new VisibleError(
				'forbidden',
				ErrorCodes.Permission.ACCOUNT_RESTRICTED,
				'The free weekend needs a verified email address and a linked Steam account.'
			);
		}

		const used = () =>
			new VisibleError(
				'forbidden',
				ErrorCodes.Permission.ACCOUNT_RESTRICTED,
				'This email address or Steam account has already had the free weekend. A plan gets you on.'
			);
		const taken = await Database.use((tx) =>
			tx
				.select({ id: TrialClaimTable.id })
				.from(TrialClaimTable)
				.where(
					sql`lower(${TrialClaimTable.email}) = ${email} or ${TrialClaimTable.steamId} = ${linked.steamId}`
				)
				.limit(1)
		);
		if (taken.length > 0) throw used();

		try {
			await Database.use((tx) =>
				tx.insert(TrialClaimTable).values({
					id: Identifier.ascending('trialClaim'),
					teamId: input.teamId,
					userId: input.userId,
					email,
					steamId: linked.steamId
				})
			);
		} catch (err) {
			const e = err as { code?: string; cause?: { code?: string } };
			if (e?.code === '23505' || e?.cause?.code === '23505') throw used();
			throw err;
		}
	}

	/**
	 * The trial runs on one machine that must be stopped now: live, and either
	 * outside the window or past the hours. Asked when the host polls for
	 * work, so a run is stopped within one poll of crossing the line.
	 */
	export async function overdue(machineId: string, at: Date = now()) {
		const live = await Database.use((tx) =>
			tx
				.select({ sessionId: SessionTable.id, boxId: BoxTable.id, userId: BoxTable.userId })
				.from(SessionTable)
				.innerJoin(BoxTable, eq(SessionTable.boxId, BoxTable.id))
				.innerJoin(MachineTable, eq(BoxTable.machineId, MachineTable.id))
				.where(
					and(
						eq(BoxTable.machineId, machineId),
						eq(SessionTable.trial, true),
						eq(SessionTable.state, 'live'),
						isNull(SessionTable.timeDeleted)
					)
				)
		);
		const w = window(at);
		const out: { sessionId: string; boxId: string; reason: 'window' | 'hours' }[] = [];
		for (const run of live) {
			if (!w.open) out.push({ sessionId: run.sessionId, boxId: run.boxId, reason: 'window' });
			else if ((await usedSeconds(run.userId, w, at)) >= SECONDS) {
				out.push({ sessionId: run.sessionId, boxId: run.boxId, reason: 'hours' });
			}
		}
		return out;
	}
}
