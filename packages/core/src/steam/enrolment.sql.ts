import { index, pgEnum, pgTable, primaryKey, text } from 'drizzle-orm/pg-core';

import { ulid, utc } from '../db/types.js';
import { MachineTable } from '../machine/machine.sql.js';
import { UserTable } from '../user/user.sql.js';

/**
 * Where an enrolment can be, and nowhere else.
 *
 * There is no `pending`. A challenge showing on a screen lives about two
 * minutes, rotates on a cadence the auth provider chooses, and nothing outside
 * the host process needs to know it exists — so it is not a fact about the
 * machine and recording it here would be a claim we cannot keep true.
 * ref(d-0004)
 */
export const SteamEnrolmentState = pgEnum('steam_enrolment_state', [
	'enrolled',
	'stale',
	'revoked'
]);

/**
 * That a host holds a Steam refresh token for a user — and never the token.
 *
 * **This table has no token column and must not gain one.** The token is
 * written by the host, encrypted, under that host's own account, and it does
 * not cross back: not in a request body, not in a log, not in an error
 * message, not as a metric label. A nullable "encrypted token" column would be
 * an invitation rather than a safeguard, because the thing standing between a
 * database leak and somebody's game library is that the credential was never
 * sent here at all. ref(d-0004)
 *
 * `steam_id` is deliberately **not unique**. One Steam account signed in on two
 * hosts is two rows and two tokens, which is the entire point of doing the auth
 * session on the machine that will use it: each token is bound to the address
 * that asked for it, and a shared one would be the theft signal we are avoiding.
 * A unique index here would read as hygiene and would refuse a person their
 * second box.
 *
 * The key is the pair, because an enrolment is a fact about *this user on this
 * host* and there is only ever one such fact. That is also why the row carries
 * no surrogate id and no soft-delete: the states are the lifecycle, and the row
 * itself goes away only when the machine or the user does.
 */
export const SteamEnrolmentTable = pgTable(
	'steam_enrolment',
	{
		machineId: ulid('machine_id')
			.notNull()
			.references(() => MachineTable.id, { onDelete: 'cascade' }),
		userId: ulid('user_id')
			.notNull()
			.references(() => UserTable.id, { onDelete: 'cascade' }),
		steamId: text('steam_id').notNull(),
		state: SteamEnrolmentState('state').notNull(),
		enrolledAt: utc('enrolled_at').notNull().defaultNow(),
		// Written when a logon actually succeeds, which happens inside the
		// workload and reports back through the host. Nothing writes it yet,
		// and it stays null rather than being filled with the time of the
		// nearest event that was easy to observe.
		lastOkAt: utc('last_ok_at'),
		revokedAt: utc('revoked_at')
	},
	(t) => [
		primaryKey({ columns: [t.machineId, t.userId] }),
		// The key starts with the machine, which answers "what does this host
		// hold" and nothing else. Deleting a user cascades into this table by
		// `user_id` alone, and asking which hosts hold a token for one person
		// is the obvious next reader — neither can use the key.
		index('steam_enrolment_user_idx').on(t.userId)
	]
);
