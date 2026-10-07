import { index, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';

import { id, timestamps, ulid } from '../db/types.js';
import { TeamTable } from '../team/team.sql.js';
import { UserTable } from '../user/user.sql.js';

/**
 * Who has had the free weekend on rented GPUs.
 *
 * One per team, one per email address and one per Steam account: an address
 * costs nothing to make, an account that owns games costs a good deal more, so
 * a second trial needs both a new address and a new Steam account.
 *
 * The row outlives the account that made it. Deleting the team or the user
 * clears those links and keeps the address and the Steam id, so closing an
 * account and signing up again is not a second trial.
 */
export const TrialClaimTable = pgTable(
	'trial_claim',
	{
		...id,
		...timestamps,
		teamId: ulid('team_id').references(() => TeamTable.id, { onDelete: 'set null' }),
		userId: ulid('user_id').references(() => UserTable.id, { onDelete: 'set null' }),
		/** Lowercased. */
		email: text('email').notNull(),
		/** The Steam account's 64-bit id, as text. */
		steamId: text('steam_id').notNull()
	},
	(t) => [
		uniqueIndex('trial_claim_email_unique').on(t.email),
		uniqueIndex('trial_claim_steam_unique').on(t.steamId),
		uniqueIndex('trial_claim_team_unique').on(t.teamId),
		index('trial_claim_user_idx').on(t.userId)
	]
);
