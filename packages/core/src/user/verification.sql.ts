import { index, integer, pgEnum, pgTable, text } from 'drizzle-orm/pg-core';

import { id, timestamps, ulid, utc } from '../db/types.js';
import { UserTable } from './user.sql.js';

export const VerificationKindEnum = pgEnum('verification_kind', ['email']);

/**
 * A short-lived code proving the owner of an email address.
 *
 * The `ver` id prefix was reserved for this before the table existed. Codes
 * are hashed at rest so a leaked database cannot be used to verify on behalf
 * of its users.
 */
export const VerificationTable = pgTable(
	'verification',
	{
		...id,
		...timestamps,
		userId: ulid('user_id')
			.notNull()
			.references(() => UserTable.id, { onDelete: 'cascade' }),
		kind: VerificationKindEnum('kind').notNull(),
		codeHash: text('code_hash').notNull(),
		expiresAt: utc('expires_at').notNull(),
		attempts: integer('attempts').notNull().default(0),
		consumedAt: utc('consumed_at')
	},
	(t) => [index('verification_user_kind_idx').on(t.userId, t.kind)]
);
