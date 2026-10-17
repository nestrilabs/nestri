import { boolean, index, pgEnum, pgTable, text } from 'drizzle-orm/pg-core';

import { id, timestamps, ulid, utc } from '../db/types.js';
import { GameTable } from '../game/game.sql.js';
import { SessionTable } from './session.sql.js';

/**
 * Where one launch inside a run is.
 *
 * `requested` is the work order, as it is for a run: the host is handed it and
 * reports `running` once the game is started in the box. `ended` and `failed`
 * are terminal. A launch never outlives its run: when the run stops, every
 * launch in it that is not over is ended with it. ref(d-0085)
 */
export const LaunchState = pgEnum('launch_state', ['requested', 'running', 'ended', 'failed']);

/**
 * One game or app started inside a running box.
 *
 * The run is still what is billed and counted; a launch costs nothing of its
 * own. A run starts with one launch, its first, which the host starts as part
 * of starting the box; any later one is handed to the host as a job of its own
 * while the box runs. When the last launch of a run is over, the run is
 * stopped. ref(d-0085)
 */
export const LaunchTable = pgTable(
	'launch',
	{
		...id,
		...timestamps,
		sessionId: ulid('session_id')
			.notNull()
			.references(() => SessionTable.id, { onDelete: 'cascade' }),
		gameId: ulid('game_id')
			.notNull()
			.references(() => GameTable.id, { onDelete: 'restrict' }),
		state: LaunchState('state').notNull().default('requested'),
		/**
		 * The launch the run was asked for with. The host starts it with the box
		 * (`session.start`), so it is never handed out as a `launch.start`.
		 */
		first: boolean('first').notNull().default(false),
		timeStarted: utc('time_started'),
		timeStopped: utc('time_stopped'),
		/** When the owner asked for this launch to end, or null if nobody has. */
		timeStopRequested: utc('time_stop_requested'),
		errorMessage: text('error_message'),
		endReason: text('end_reason')
	},
	(t) => [index('launch_session_idx').on(t.sessionId), index('launch_state_idx').on(t.state)]
);
