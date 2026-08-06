import { eq, and, isNull, sql } from 'drizzle-orm';
import z from 'zod';

import { Database } from '../db/index.js';
import { Examples } from '../examples.js';
import { fn } from '../fn.js';
import { UserTable } from './user.sql.js';

export namespace User {
	export const Info = z
		.object({
			id: z.string().meta({
				description: 'Unique identifier for the user record',
				example: Examples.User.id
			}),
			name: z.string().meta({
				description: 'The display name associated with this account',
				example: Examples.User.name
			}),
			email: z.email().optional().nullable().optional().meta({
				description:
					'Primary email address for account notifications and billing. May be null for gaming-only accounts.',
				example: Examples.User.email
			}),
			emailVerified: z.boolean().meta({
				description: 'Indicates whether the email address has been verified',
				example: Examples.User.emailVerified
			}),
			image: z.string().nullable().optional().meta({
				description: "URL pointing to the user's profile picture",
				example: Examples.User.image
			})
		})
		.meta({
			ref: 'User',
			description: 'User account entity with core identification details',
			example: Examples.User
		});

	export type Info = z.infer<typeof Info>;

	export const create = fn(
		Info.pick({ id: true, name: true, email: true, emailVerified: true, image: true }),
		async (input) => {
			await Database.use(async (tx) => {
				await tx
					.insert(UserTable)
					.values({
						id: input.id,
						name: input.name || 'Player',
						email: input.email ?? null,
						emailVerified: input.emailVerified ?? false,
						image: input.image ?? null
					})
					.onConflictDoNothing({ target: UserTable.id });
			});
			return input.id;
		}
	);

	export const fromID = fn(Info.shape.id, async (id) => {
		return Database.use(async (tx) => {
			return tx
				.select()
				.from(UserTable)
				.where(and(eq(UserTable.id, id), isNull(UserTable.timeDeleted)))
				.then((rows) => rows.at(0) ?? null);
		});
	});

	export const fromEmail = fn(z.email(), async (email) => {
		return Database.use(async (tx) => {
			return tx
				.select()
				.from(UserTable)
				.where(and(eq(UserTable.email, email), isNull(UserTable.timeDeleted)))
				.then((rows) => rows.at(0) ?? null);
		});
	});

	export async function list() {
		return Database.use(async (tx) => {
			return tx
				.select()
				.from(UserTable)
				.where(isNull(UserTable.timeDeleted))
				.orderBy(UserTable.timeCreated);
		});
	}

	export const updateEmail = fn(
		Info.pick({ id: true, emailVerified: true }).extend({ email: z.email() }),
		async (input) => {
			await Database.use(async (tx) => {
				await tx
					.update(UserTable)
					.set({
						email: input.email,
						emailVerified: input.emailVerified ?? false
					})
					.where(eq(UserTable.id, input.id));
			});
		}
	);

	export const remove = fn(Info.shape.id, async (id) => {
		await Database.use(async (tx) => {
			await tx
				.update(UserTable)
				.set({ timeDeleted: sql`now()` })
				.where(eq(UserTable.id, id));
		});
	});

	export function serialize(input: typeof UserTable.$inferSelect): z.infer<typeof Info> {
		return {
			id: input.id,
			name: input.name,
			email: input.email,
			emailVerified: input.emailVerified,
			image: input.image
		};
	}
}
