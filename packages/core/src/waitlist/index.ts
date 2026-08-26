import { and, eq, isNull } from 'drizzle-orm';
import z from 'zod';

import { Database } from '../db/index.js';
import { Examples } from '../examples.js';
import { fn } from '../fn.js';
import { Identifier } from '../id.js';
import { WaitlistEntryTable } from './waitlist.sql.js';

export namespace Waitlist {
	export const Info = z
		.object({
			id: z.string().meta({
				description: 'Unique identifier for the waitlist entry',
				example: Examples.WaitlistEntry.id
			}),
			email: z.email().meta({
				description: 'The email to notify',
				example: Examples.WaitlistEntry.email
			}),
			source: z.string().meta({
				description: 'What the signup was for',
				example: Examples.WaitlistEntry.source
			}),
			timeCreated: z.iso.datetime().meta({
				description: 'When the signup happened',
				example: Examples.WaitlistEntry.timeCreated
			})
		})
		.meta({
			ref: 'WaitlistEntry',
			description: 'A waitlist signup for a not-yet-launched feature',
			example: Examples.WaitlistEntry
		});

	export type Info = z.infer<typeof Info>;

	export const join = fn(Info.pick({ email: true, source: true }), async (input) => {
		const existing = await Database.use(async (tx) => {
			return tx
				.select()
				.from(WaitlistEntryTable)
				.where(and(eq(WaitlistEntryTable.email, input.email), isNull(WaitlistEntryTable.timeDeleted)))
				.then((rows) => rows.at(0) ?? null);
		});
		if (existing) {
			// Joining twice changes nothing; the entry stays as it was.
			return serialize(existing);
		}

		const row = await Database.use(async (tx) => {
			return tx
				.insert(WaitlistEntryTable)
				.values({
					id: Identifier.ascending('waitlistEntry'),
					email: input.email,
					source: input.source
				})
				.returning()
				.then((rows) => rows.at(0));
		});
		return row ? serialize(row) : null;
	});

	export async function list() {
		return Database.use(async (tx) => {
			return tx
				.select()
				.from(WaitlistEntryTable)
				.where(isNull(WaitlistEntryTable.timeDeleted))
				.orderBy(WaitlistEntryTable.timeCreated);
		});
	}

	export function serialize(input: typeof WaitlistEntryTable.$inferSelect): Info {
		return {
			id: input.id,
			email: input.email,
			source: input.source,
			timeCreated: input.timeCreated.toISOString()
		};
	}
}
