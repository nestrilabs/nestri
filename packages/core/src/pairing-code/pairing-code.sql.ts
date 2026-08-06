import { boolean, index, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';

import { id, timestamps, utc } from '../db/types.js';

export const PairingCodeTable = pgTable(
	'pairing_code',
	{
		...id,
		...timestamps,
		code: text('code').notNull(),
		targetUserId: text('target_user_id').notNull(),
		newFingerprint: text('new_fingerprint'),
		expiresAt: utc('expires_at').notNull(),
		claimedAt: utc('claimed_at'),
		isClaimed: boolean('is_claimed').notNull().default(false)
	},
	(t) => [
		uniqueIndex('pairing_code_code_unique').on(t.code),
		index('pairing_code_target_user_idx').on(t.targetUserId)
	]
);
