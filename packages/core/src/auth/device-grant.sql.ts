import { integer, jsonb, pgEnum, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';

import { id, timestamps, utc } from '../db/types.js';

export const DeviceGrantStatusEnum = pgEnum('device_grant_status', [
	'pending',
	'approved',
	'denied'
]);

/**
 * A device authorization grant, while it is still in flight.
 *
 * This is short-lived state that would sit happily in a cache, and it is in a
 * table anyway. The reason is that every transition here has to happen exactly
 * once while two parties are touching the row — a browser somebody is clicking
 * through, and a program polling every few seconds — and a store that can only
 * read and write whole records cannot promise that. Here, approving is one
 * conditional update and redeeming is one delete that returns what it deleted,
 * so the two cannot interleave into each other.
 *
 * `device_code_hash` and not the code: the code is the credential the tokens
 * are handed to, so what is kept is enough to recognise it and not enough to
 * present it. `user_code` is stored as written, because it is read off a screen
 * by the person who is looking at it and lives for minutes.
 */
export const DeviceGrantTable = pgTable(
	'device_grant',
	{
		...id,
		...timestamps,

		deviceCodeHash: text('device_code_hash').notNull(),
		userCode: text('user_code').notNull(),
		clientId: text('client_id').notNull(),
		status: DeviceGrantStatusEnum('status').notNull().default('pending'),

		/** Seconds the client is currently being told to wait between polls. */
		pollInterval: integer('poll_interval').notNull(),
		/** Null until a poll has been given a real answer. */
		lastPolledAt: utc('last_polled_at'),
		expiresAt: utc('expires_at').notNull(),

		/**
		 * Who the grant turned out to be for, written when it is approved.
		 *
		 * Not the tokens. Those are minted when the waiting program redeems the
		 * code, so their lifetime starts when they are handed over and a grant
		 * nobody collects leaves no usable credential behind.
		 */
		subject: jsonb('subject').$type<{
			subject: string;
			type: string;
			properties: unknown;
			ttl: { access: number; refresh: number };
		}>()
	},
	(t) => [
		uniqueIndex('device_grant_device_code_unique').on(t.deviceCodeHash),
		uniqueIndex('device_grant_user_code_unique').on(t.userCode)
	]
);
