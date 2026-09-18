import { sql } from 'drizzle-orm';
import { bigint, index, integer, pgTable, uniqueIndex } from 'drizzle-orm/pg-core';

import { id, timestamps, ulid, utc } from '../db/types.js';
import { SessionTable } from '../session/session.sql.js';
import { TeamTable } from '../team/team.sql.js';

/**
 * What a team has spent, per window, and when that total started.
 *
 * Its own table rather than columns on `team`, because this row is written
 * every time anything ticks while `team` is read on a great many paths that
 * have nothing to do with billing. Keeping the hot write off the row everyone
 * reads is the whole reason for the join.
 *
 * **Each total is stored beside the time it began**, and a total whose stamp
 * has fallen outside its window reads as zero. That is what replaces a reset
 * job: nothing has to run for a window to roll clear, so there is no schedule
 * to misfire and no race between a reset and a write arriving together. The
 * same rule on the way in — add to the total if the stamp is still inside the
 * window, otherwise start again from this amount — is one statement.
 *
 * Totals are derived and disposable. {@link BurnSegmentTable} is the record;
 * these can be rebuilt from it, which is why zeroing one by hand is a support
 * action rather than data loss.
 */
export const BurnCounterTable = pgTable(
	'burn_counter',
	{
		...id,
		...timestamps,
		teamId: ulid('team_id')
			.notNull()
			.references(() => TeamTable.id, { onDelete: 'cascade' }),
		// Reference-seconds, so these are readable as time. `bigint` because a
		// busy team on a long window is well past what an int holds.
		fiveHourUsage: bigint('five_hour_usage', { mode: 'number' }).notNull().default(0),
		fiveHourAt: utc('five_hour_at'),
		sevenDayUsage: bigint('seven_day_usage', { mode: 'number' }).notNull().default(0),
		sevenDayAt: utc('seven_day_at'),
		thirtyDayUsage: bigint('thirty_day_usage', { mode: 'number' }).notNull().default(0),
		thirtyDayAt: utc('thirty_day_at')
	},
	(t) => [uniqueIndex('burn_counter_team_unique').on(t.teamId)]
);

/**
 * One stretch of one run at one unchanging rate.
 *
 * Not a row per session and not a row per event. A session's rate is fixed
 * when it starts — every factor is knowable before the run, which is what lets
 * a person be told the cost before they commit to it — but it does not stay
 * fixed for the session's life, because starting a second run changes what the
 * account spends per second while the first is still going.
 *
 * So the record is a segment: opened when the rate becomes true, closed when it
 * stops being true, and never edited afterwards. Burn is the sum of duration
 * times rate over segments, every rate stamped at the moment it applied, and
 * "the number shown is the number billed" holds because there is no later
 * recalculation that could reach a different answer.
 */
export const BurnSegmentTable = pgTable(
	'burn_segment',
	{
		...id,
		...timestamps,
		// The billing subject. Denormalized from the session's box on purpose:
		// which team paid is a fact about the moment, and re-deriving it later
		// through hardware that may since have moved would answer differently.
		teamId: ulid('team_id')
			.notNull()
			.references(() => TeamTable.id, { onDelete: 'restrict' }),
		// `restrict`, because deleting a run must not erase what it cost.
		sessionId: ulid('session_id')
			.notNull()
			.references(() => SessionTable.id, { onDelete: 'restrict' }),
		/**
		 * Units of burn per second, times a thousand.
		 *
		 * Scaled so the factors can be fractional without any of this becoming
		 * floating point: a rate of 1.5x is 1500. Burn is then
		 * `seconds * rate_milli / 1000`, in integers, and two readers of the
		 * same row cannot disagree in the last digit.
		 */
		rateMilli: integer('rate_milli').notNull(),
		startedAt: utc('started_at').notNull(),
		/** Null while the segment is the current one for that run. */
		endedAt: utc('ended_at')
	},
	(t) => [
		index('burn_segment_team_idx').on(t.teamId),
		index('burn_segment_session_idx').on(t.sessionId),
		// At most one open segment per run: a second would double-count every
		// tick for as long as both stayed open, and silently.
		uniqueIndex('burn_segment_one_open_per_session')
			.on(t.sessionId)
			.where(sql`${t.endedAt} is null`)
	]
);
