import { index, jsonb, pgEnum, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';

import { id, timestamps, ulid } from '../db/types.js';
import { UserTable } from '../user/user.sql.js';

export const ProviderEnum = pgEnum('linked_account_provider', ['steam', 'ssh', 'discord']);

export const LinkedAccountTable = pgTable(
	'linked_account',
	{
		...id,
		...timestamps,
		userId: ulid('user_id')
			.notNull()
			.references(() => UserTable.id, { onDelete: 'cascade' }),
		provider: ProviderEnum('provider').notNull(),
		providerAccountId: text('provider_account_id').notNull(),
		profile: jsonb('profile').$type<{}>()
	},
	(t) => [
		uniqueIndex('linked_account_provider_unique').on(t.provider, t.providerAccountId),
		index('linked_account_user_idx').on(t.userId)
	]
);
