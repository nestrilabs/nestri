import { index, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';

import { id, timestamps, ulid, utc } from '../db/types.js';
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
		// Set only when the box was registered by someone acting inside a team.
		// A personal box has no team, and requiring one would make registering
		// impossible for the single-operator case that self-hosting is.
		teamId: ulid('team_id'),
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
