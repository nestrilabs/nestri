import { boolean, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';

import { BoxTable } from '../box/box.sql.js';
import { id, timestamps, ulid } from '../db/types.js';
import { TeamTable } from '../team/team.sql.js';

/**
 * The room a paid checkout asked for, one row per subscription.
 *
 * The unique subscription id is what makes a redelivered webhook harmless: the
 * first delivery claims the row, every later one finds it taken and does
 * nothing. The row is kept even when no room could be made, so a retry cannot
 * hand out a card the person was already told was not there.
 */
export const CheckoutRoomTable = pgTable(
	'checkout_room',
	{
		...id,
		...timestamps,
		teamId: ulid('team_id')
			.notNull()
			.references(() => TeamTable.id, { onDelete: 'cascade' }),
		subscriptionId: text('subscription_id').notNull(),
		/** The fleet model the person picked before paying. */
		requestedModel: text('requested_model').notNull(),
		/** The model the room went on; null when nothing was free. */
		placedModel: text('placed_model'),
		substituted: boolean('substituted').notNull().default(false),
		boxId: ulid('box_id').references(() => BoxTable.id, { onDelete: 'set null' })
	},
	(table) => [uniqueIndex('checkout_room_subscription_idx').on(table.subscriptionId)]
);
