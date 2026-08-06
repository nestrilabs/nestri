import { index, pgTable, pgEnum, uniqueIndex } from 'drizzle-orm/pg-core';

import { id, timestamps, ulid } from '../db/types.js';
import { UserTable } from '../user/user.sql.js';
import { TeamTable } from './team.sql.js';

export const TeamMemberRole = pgEnum('team_member_role', ['owner', 'admin', 'member']);

export const TeamMemberTable = pgTable(
	'team_member',
	{
		...id,
		...timestamps,
		teamId: ulid('team_id')
			.notNull()
			.references(() => TeamTable.id, { onDelete: 'cascade' }),
		userId: ulid('user_id')
			.notNull()
			.references(() => UserTable.id, { onDelete: 'cascade' }),
		role: TeamMemberRole('role').notNull().default('member')
	},
	(t) => [
		uniqueIndex('team_member_team_user_unique').on(t.teamId, t.userId),
		index('team_member_team_idx').on(t.teamId),
		index('team_member_user_idx').on(t.userId)
	]
);
