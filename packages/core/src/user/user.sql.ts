import { boolean, pgTable, text } from 'drizzle-orm/pg-core';

import { id, timestamps } from '../db/types.js';

export const UserTable = pgTable('user', {
	...id,
	...timestamps,
	name: text('name').notNull(),
	email: text('email'),
	emailVerified: boolean('email_verified').notNull().default(false),
	image: text('image')
});
