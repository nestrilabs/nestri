import { index, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';

import { id, timestamps } from '../db/types.js';

/**
 * Someone asking to be told when a self-hosted machines feature launches.
 *
 * Kept deliberately dumb: an email and where it came from. No auth — the whole
 * point is that a visitor without an account can leave one.
 */
export const WaitlistEntryTable = pgTable(
	'waitlist_entry',
	{
		...id,
		...timestamps,
		email: text('email').notNull(),
		// What the signup was for (e.g. "machines"), so one form can grow
		// into several without a schema change.
		source: text('source').notNull().default('machines')
	},
	(t) => [
		uniqueIndex('waitlist_entry_email_unique').on(t.email),
		index('waitlist_entry_source_idx').on(t.source)
	]
);
