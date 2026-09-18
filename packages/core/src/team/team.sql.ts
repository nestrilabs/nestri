import { index, jsonb, pgTable, text } from 'drizzle-orm/pg-core';

import { id, timestamps, ulid } from '../db/types.js';
import { OrganisationTable } from '../organisation/organisation.sql.js';
import { UserTable } from '../user/user.sql.js';

export const TeamTable = pgTable(
	'team',
	{
		...id,
		...timestamps,
		name: text('name').notNull(),
		slug: text('slug').notNull().unique(),
		ownerId: ulid('owner_id')
			.notNull()
			.references(() => UserTable.id, { onDelete: 'cascade' }),
		/**
		 * The organisation this team belongs to, if it belongs to one.
		 *
		 * Null for every personal team, which is most of them, and that is the
		 * ordinary case rather than a missing value. It groups teams under a
		 * company and decides which of them a verified domain reaches; it does not
		 * move billing, which stays on the team either way.
		 *
		 * `restrict`, so an organisation with teams cannot be deleted out from
		 * under them — where those teams should go is a decision, and there is no
		 * UI for it, so the database refuses rather than guessing.
		 */
		organisationId: ulid('organisation_id').references(() => OrganisationTable.id, {
			onDelete: 'restrict'
		}),
		billingEmail: text('billing_email'),
		plan: text('plan').notNull().default('free'),
		subscriptionStatus: text('subscription_status').notNull().default('active'),
		metadata: jsonb('metadata').$type<{}>()
	},
	(t) => [index('team_organisation_idx').on(t.organisationId)]
);
