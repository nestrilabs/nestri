import { index, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';

import { id, timestamps, ulid, utc } from '../db/types.js';
import { TeamTable } from '../team/team.sql.js';
import { UserTable } from '../user/user.sql.js';

/**
 * A registered nessh host — the *box* that runs downloads and serves SSH, not
 * the laptop someone connects from. (`nessh-tui-redesign-guide.md` §7.2 uses
 * "machine" for the other end of that connection; this table is the host end.)
 *
 * A box does not assert who it is. It registers once against an owner's token
 * and is handed an id and a secret, so ids are unique because the API assigns
 * them rather than because a self-reported string happened not to collide.
 */
export const MachineTable = pgTable(
	'machine',
	{
		...id,
		...timestamps,
		ownerUserId: ulid('owner_user_id')
			.notNull()
			.references(() => UserTable.id, { onDelete: 'cascade' }),
		// Every user gets a personal team at signup, so there is always one to
		// point at and the single-operator case is a team of one rather than a
		// special case in every query. This was nullable, which cost a
		// `teamId ?? ownerUserId` branch at each call site instead. ref(d-0048)
		teamId: ulid('team_id')
			.notNull()
			.references(() => TeamTable.id, { onDelete: 'restrict' }),
		label: text('label').notNull(),
		// Where this host can actually be reached: its own endpoint id, as
		// hex. A row can be authorised perfectly and still have nowhere to
		// send the request without it, which is what this column fixes.
		//
		// **Reported, never assigned.** A host holds the secret half and is
		// the only thing that can know the public one first, so the control
		// plane records what it is told rather than handing one out. ref(d-0010)
		//
		// Nullable because a host that has never reported one is a real state
		// — every host registered before this column existed is in it — and
		// the honest reading of null is "not reachable yet" rather than a
		// default that would route somewhere wrong. Unique because an endpoint
		// id belongs to one host: two rows claiming the same one would send a
		// request addressed to one machine to a different machine's agent.
		endpointId: text('endpoint_id'),
		// The secret itself is returned exactly once, at registration, and never
		// stored: a leaked database must not yield working box credentials.
		secretHash: text('secret_hash').notNull(),
		lastSeen: utc('last_seen')
	},
	(t) => [
		uniqueIndex('machine_secret_hash_unique').on(t.secretHash),
		uniqueIndex('machine_endpoint_id_unique').on(t.endpointId),
		index('machine_owner_idx').on(t.ownerUserId),
		index('machine_team_idx').on(t.teamId)
	]
);
