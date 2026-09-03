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
		// special case in every query. This was nullable until 0048, which cost
		// a `teamId ?? ownerUserId` branch at each call site instead.
		teamId: ulid('team_id')
			.notNull()
			.references(() => TeamTable.id, { onDelete: 'restrict' }),
		label: text('label').notNull(),
		// The secret itself is returned exactly once, at registration, and never
		// stored: a leaked database must not yield working box credentials.
		secretHash: text('secret_hash').notNull(),
		lastSeen: utc('last_seen')
	},
	(t) => [
		uniqueIndex('machine_secret_hash_unique').on(t.secretHash),
		index('machine_owner_idx').on(t.ownerUserId),
		index('machine_team_idx').on(t.teamId)
	]
);
