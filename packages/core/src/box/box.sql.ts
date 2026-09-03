import { boolean, index, pgEnum, pgTable, text } from 'drizzle-orm/pg-core';

import { id, timestamps, ulid } from '../db/types.js';
import { MachineTable } from '../machine/machine.sql.js';
import { UserTable } from '../user/user.sql.js';

/**
 * The named size a box was asked for.
 *
 * A tier is the unit of sale and it includes output geometry
 * ([0021](../../../../.nestri/decisions/0021-vm-size-tiers.md)), so this column
 * decides vCPU, RAM *and* the resolution the guest is told to render at. It is
 * a *request*: `(tier, gpu_model)` is what admission actually acts on, and
 * admission does not exist yet.
 */
export const BoxTier = pgEnum('box_tier', ['xs', 'sm', 'md', 'lg', 'xl']);

/**
 * What the box is doing, in `neslet`'s own vocabulary.
 *
 * Deliberately the same three states `neslet` reports over its control socket
 * and no more. `starting` and `stopping` are the obvious additions and both are
 * omitted, because nothing would ever write them: the agent's transitions are
 * synchronous from its side, so a state nobody sets is a state that lies. A box
 * that failed is `stopped` with `stopClean` false, which is also how `neslet`
 * models it — "it is not running" and "it faulted forty seconds ago" are
 * different facts, and the difference lives in the reason, not in the state.
 */
export const BoxState = pgEnum('box_state', ['created', 'running', 'stopped']);

/**
 * A VM someone owns.
 *
 * Nothing represented a box until now
 * ([0048](../../../../.nestri/decisions/0048-email-is-the-root-identity-and-a-box-is-a-row.md)):
 * `machine` is the *host*, and a guest had no id a URL could carry, no owner,
 * no place, and no state anything could poll. Every screen the desktop app
 * still needs is a view over this table.
 *
 * **A box is owned by a person and placed on a team's hardware, and those are
 * two different relationships.** Hence both `userId` and `machineId`: the
 * person is who it belongs to and who gets billed through its sessions, the
 * machine is where it currently runs. Moving a box to another host changes the
 * second and not the first.
 */
export const BoxTable = pgTable(
	'box',
	{
		...id,
		...timestamps,
		userId: ulid('user_id')
			.notNull()
			.references(() => UserTable.id, { onDelete: 'cascade' }),
		// `restrict` rather than `cascade`: deleting a host must not silently
		// delete the boxes someone owns on it. Detaching them is a decision with
		// a UI, and there is no UI, so the database refuses instead of guessing.
		machineId: ulid('machine_id')
			.notNull()
			.references(() => MachineTable.id, { onDelete: 'restrict' }),
		// The DNS label is the id, per 0019 — `<box_id>.nestri.link`. This is the
		// display string a person edits, and it is deliberately not unique:
		// two boxes called "living room" are the owner's problem, not an error.
		label: text('label').notNull(),
		tier: BoxTier('tier').notNull().default('sm'),
		state: BoxState('state').notNull().default('created'),
		/** Why it stopped, verbatim from `neslet`. Null while it has never run. */
		stopReason: text('stop_reason'),
		/** Whether that stop was a clean exit. Null while it has never run. */
		stopClean: boolean('stop_clean')
	},
	(t) => [index('box_user_idx').on(t.userId), index('box_machine_idx').on(t.machineId)]
);
