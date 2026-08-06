import { jsonb, pgTable, text } from 'drizzle-orm/pg-core';

import { id, timestamps, ulid } from '../db/types.js';
import { UserTable } from '../user/user.sql.js';

export const TeamTable = pgTable('team', {
	...id,
	...timestamps,
	name: text('name').notNull(),
	slug: text('slug').notNull().unique(),
	ownerId: ulid('owner_id')
		.notNull()
		.references(() => UserTable.id, { onDelete: 'cascade' }),
	billingEmail: text('billing_email'),
	plan: text('plan').notNull().default('free'),
	subscriptionStatus: text('subscription_status').notNull().default('active'),
	metadata: jsonb('metadata').$type<{}>()
});
