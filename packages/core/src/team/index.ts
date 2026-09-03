import { eq, and, isNull, sql } from 'drizzle-orm';
import z from 'zod';

import { Actor } from '../actor.js';
import { Database } from '../db/index.js';
import { Examples } from '../examples.js';
import { fn } from '../fn.js';
import { Identifier } from '../id.js';
import { TeamMemberTable } from './member.sql.js';
import { TeamTable } from './team.sql.js';

export namespace Team {
	export const Info = z
		.object({
			id: z.string().meta({
				description: 'Unique identifier for the team record',
				example: Examples.Team.id
			}),
			name: z.string().meta({
				description: 'Display name of the team',
				example: Examples.Team.name
			}),
			slug: z.string().meta({
				description: 'URL-friendly unique slug for the team',
				example: Examples.Team.slug
			}),
			ownerId: z.string().meta({
				description: 'The user who owns/created this team',
				example: Examples.Team.ownerId
			}),
			billingEmail: z.email().nullable().optional().meta({
				description: 'Email address used for billing and invoices',
				example: Examples.Team.billingEmail
			}),
			plan: z.string().optional().meta({
				description: 'Current billing plan (free, pro, team, enterprise)',
				example: Examples.Team.plan
			}),
			subscriptionStatus: z.string().optional().meta({
				description: 'Current subscription status (active, past_due, canceled, etc.)',
				example: Examples.Team.subscriptionStatus
			}),
			metadata: z.record(z.string(), z.unknown()).nullable().optional().meta({
				description: 'Arbitrary metadata attached to the team',
				example: Examples.Team.metadata
			})
		})
		.meta({
			ref: 'Team',
			description:
				'A team/organization for collaboration and billing. Users join teams via memberships.',
			example: Examples.Team
		});

	export type Info = z.infer<typeof Info>;

	export const create = fn(Info.pick({ id: true, name: true, slug: true }), async (input) => {
		const ownerId = Actor.userID;
		await Database.use(async (tx) => {
			await tx.insert(TeamTable).values({
				id: input.id,
				name: input.name,
				slug: input.slug,
				ownerId
			});
			await tx.insert(TeamMemberTable).values({
				id: Identifier.ascending('teamMember'),
				teamId: input.id,
				userId: ownerId,
				role: 'owner'
			});
		});
		return input.id;
	});

	export const fromID = fn(Info.shape.id, async (id) => {
		return Database.use(async (tx) => {
			return tx
				.select()
				.from(TeamTable)
				.where(and(eq(TeamTable.id, id), isNull(TeamTable.timeDeleted)))
				.then((rows) => rows.at(0) ?? null);
		});
	});

	export const fromSlug = fn(Info.shape.slug, async (slug) => {
		return Database.use(async (tx) => {
			return tx
				.select()
				.from(TeamTable)
				.where(and(eq(TeamTable.slug, slug), isNull(TeamTable.timeDeleted)))
				.then((rows) => rows.at(0) ?? null);
		});
	});

	export async function list() {
		return Database.use(async (tx) => {
			return tx
				.select()
				.from(TeamTable)
				.where(isNull(TeamTable.timeDeleted))
				.orderBy(TeamTable.timeCreated);
		});
	}

	export const remove = fn(Info.shape.id, async (id) => {
		await Database.use(async (tx) => {
			await tx
				.update(TeamTable)
				.set({ timeDeleted: sql`now()` })
				.where(eq(TeamTable.id, id));
		});
	});

	/**
	 * The team a user owns by virtue of existing.
	 *
	 * Defined as the oldest team they own, because {@link createPersonal} is the
	 * only thing that mints a team at signup — so the first one is the personal
	 * one and any later ones were made deliberately. This is a convention, not a
	 * column: adding an `isPersonal` flag would let the two disagree, and there
	 * is nothing yet that needs them to. ref(d-0048)
	 */
	export const personalFor = fn(Info.shape.ownerId, async (ownerId) => {
		return Database.use(async (tx) => {
			return tx
				.select()
				.from(TeamTable)
				.where(and(eq(TeamTable.ownerId, ownerId), isNull(TeamTable.timeDeleted)))
				.orderBy(TeamTable.timeCreated)
				.limit(1)
				.then((rows) => rows.at(0) ?? null);
		});
	});

	/**
	 * The personal team, made if it is not there.
	 *
	 * Every user has needed one since `machine.teamId` became notNull, so signup
	 * calls this and so does anything that needs somewhere to put a host.
	 * Idempotent, because it runs on every login rather than only on the first
	 * one — an older user with no team gets one the next time they appear.
	 */
	export const ensurePersonal = fn(z.object({ displayName: z.string() }), async (input) => {
		const existing = await personalFor(Actor.userID);
		if (existing) {
			return existing.id;
		}
		return createPersonal({ displayName: input.displayName });
	});

	export const createPersonal = fn(z.object({ displayName: z.string() }), async (input) => {
		const baseSlug = input.displayName
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-|-$/g, '')
			.slice(0, 50);

		const existing = await fromSlug(baseSlug);
		const slug = existing
			? `${baseSlug}-${String(Math.floor(Math.random() * 9999)).padStart(4, '0')}`
			: baseSlug;

		const id = Identifier.ascending('team');
		return create({ id, name: `${input.displayName}'s Team`, slug });
	});

	export function serialize(input: typeof TeamTable.$inferSelect): z.infer<typeof Info> {
		return {
			id: input.id,
			name: input.name,
			slug: input.slug,
			ownerId: input.ownerId,
			billingEmail: input.billingEmail,
			plan: input.plan,
			subscriptionStatus: input.subscriptionStatus,
			metadata: input.metadata
		};
	}
}
