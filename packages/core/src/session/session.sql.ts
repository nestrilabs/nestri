import { index, pgEnum, pgTable, text } from 'drizzle-orm/pg-core';

import { id, timestamps, ulid, utc } from '../db/types.js';
import { BoxTable } from '../box/box.sql.js';
import { GameTable } from '../game/game.sql.js';
import { LinkedAccountTable } from '../user/linked-account.sql.js';

/**
 * Where a session is in its one and only run.
 *
 * `requested` is written by `POST /session` before anything has been placed,
 * which is what makes the row the job: the control plane picks a machine and
 * the agent on it takes over from there. `live` is the only state that costs
 * money.
 */
export const SessionState = pgEnum('session_state', [
	'requested',
	'starting',
	'live',
	'ended',
	'failed'
]);

/**
 * One live run of one box, and the thing that gets billed.
 *
 * Separate from `box` for two reasons. A box is a durable thing somebody owns,
 * while a session is what costs money and what quota is measured in
 * session-hours against. And the connect ticket **changes after bind as
 * addresses are discovered** — it is republished rather than issued once, so
 * `ticket` is a column rewritten in place while the session starts and a
 * client polls it instead of receiving a final value. ref(d-0048)
 */
export const SessionTable = pgTable(
	'session',
	{
		...id,
		...timestamps,
		boxId: ulid('box_id')
			.notNull()
			.references(() => BoxTable.id, { onDelete: 'cascade' }),
		gameId: ulid('game_id')
			.notNull()
			.references(() => GameTable.id, { onDelete: 'restrict' }),
		// Which Steam account this run is playing as. A user may link several,
		// and *which one* is the question the "who's playing?" screen asks — so
		// it belongs on the session and not on the box.
		//
		// `restrict`, because unlinking a Steam account must not erase the
		// billing history of what it played.
		linkedAccountId: ulid('linked_account_id')
			.notNull()
			.references(() => LinkedAccountTable.id, { onDelete: 'restrict' }),
		state: SessionState('state').notNull().default('requested'),
		/**
		 * The current iroh connect ticket, or null before `neshub` has minted
		 * one. Rewritten as addresses are discovered; never append-only.
		 */
		ticket: text('ticket'),
		/** Null until the box actually starts, which is not when the row appears. */
		timeStarted: utc('time_started'),
		timeStopped: utc('time_stopped'),
		/** Why it ended badly, when it did. */
		errorMessage: text('error_message')
	},
	(t) => [
		index('session_box_idx').on(t.boxId),
		index('session_state_idx').on(t.state),
		// Metering reads "sessions in this window", and this table is what
		// billing sums, so the time index is not speculative. ref(d-0048)
		index('session_started_idx').on(t.timeStarted)
	]
);
