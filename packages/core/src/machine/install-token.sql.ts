import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';

import { id, timestamps, ulid, utc } from '../db/types.js';
import { OrganisationTable } from '../organisation/organisation.sql.js';
import { TeamTable } from '../team/team.sql.js';
import { UserTable } from '../user/user.sql.js';
import { MachineTable } from './machine.sql.js';

/**
 * A one-time credential that registers exactly one machine to one team, or to
 * one organisation's fleet — never both, by the same rule a machine has.
 *
 * It exists so that installing on a host is a command a person pastes, rather
 * than a user session copied onto a machine. It travels in that command, so it
 * lands in shell history: that is why it is single-use, expires in minutes,
 * and is stored only as a digest.
 */
export const InstallTokenTable = pgTable(
	'install_token',
	{
		...id,
		...timestamps,
		teamId: ulid('team_id').references(() => TeamTable.id, { onDelete: 'cascade' }),
		organisationId: ulid('organisation_id').references(() => OrganisationTable.id, {
			onDelete: 'cascade'
		}),
		// Who asked for it. They become the machine's owner, as they would have
		// by registering it with their own session.
		createdByUserId: ulid('created_by_user_id')
			.notNull()
			.references(() => UserTable.id, { onDelete: 'cascade' }),
		tokenHash: text('token_hash').notNull(),
		expiresAt: utc('expires_at').notNull(),
		redeemedAt: utc('redeemed_at'),
		// The machine it made. Null until redeemed; kept afterwards so a support
		// conversation can say which command produced which host.
		machineId: ulid('machine_id').references(() => MachineTable.id, { onDelete: 'set null' })
	},
	(t) => [
		uniqueIndex('install_token_hash_unique').on(t.tokenHash),
		index('install_token_team_idx').on(t.teamId),
		check('install_token_one_owner', sql`(${t.teamId} is null) != (${t.organisationId} is null)`)
	]
);
