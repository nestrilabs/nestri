import { sql } from 'drizzle-orm';
import { boolean, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';

import { id, timestamps } from '../db/types.js';

export const UserTable = pgTable(
	'user',
	{
		...id,
		...timestamps,
		name: text('name').notNull(),
		/**
		 * The address the account is rooted in.
		 *
		 * Nullable only because accounts exist that predate the rule — every
		 * one of those was made by signing in with a gaming account and was
		 * never asked for an address. A new account cannot be created without
		 * one. ref(d-0048)
		 */
		email: text('email'),
		emailVerified: boolean('email_verified').notNull().default(false),
		image: text('image')
	},
	(t) => [
		// One address, one account, which is what makes it a root identity
		// rather than a contact detail. Partial because the accounts made
		// before this rule have no address at all, and "no address" is not a
		// value two of them can collide on.
		//
		// The column holds a trimmed, lower-cased address; nothing here
		// enforces that, so anything writing it has to normalize first.
		uniqueIndex('user_email_unique')
			.on(t.email)
			.where(sql`email is not null and time_deleted is null`)
	]
);
