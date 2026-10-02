import { eq, and, isNull, sql } from 'drizzle-orm';
import z from 'zod';

import { Actor } from '../actor.js';
import { Polar } from '../billing/polar.js';
import { Database } from '../db/index.js';
import { Examples } from '../examples.js';
import { fn } from '../fn.js';
import { Identifier } from '../id.js';
import { User } from '../user/index.js';
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
			organisationId: z.string().nullable().optional().meta({
				description:
					'The organisation this team belongs to, or null for a personal team. It groups teams under a company; it does not move billing, which stays on the team',
				example: Examples.Team.organisationId
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

		// Register the team with the payment provider, *after* the rows are
		// committed and without being able to affect them.
		//
		// Every team exists on their side, free ones included, so that an
		// upgrade changes a subscription rather than inventing a customer and
		// there is one question to ask about anybody rather than two.
		//
		// **Signing up is not allowed to depend on a third party.** So this
		// cannot run inside the transaction, cannot fail the call, and does not
		// retry: a team that misses it is free, which is what it would have been
		// anyway, and the next call puts it right because the operation is
		// idempotent.
		Database.effect(async () => {
			try {
				// The owner's address, so a customer can be found or made. A team
				// created by somebody with no verified address gets no customer
				// yet, which is a state `ensureFree` reports rather than guesses
				// its way out of.
				const owner = await User.fromID(ownerId);
				await Polar.ensureFree({ teamId: input.id, email: owner?.email ?? undefined });
			} catch (error) {
				// eslint-disable-next-line no-console
				console.error('could not register team with the payment provider:', error);
			}
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

		const existing = RESERVED.has(baseSlug) || (await fromSlug(baseSlug));
		const slug = existing
			? `${baseSlug}-${String(Math.floor(Math.random() * 9999)).padStart(4, '0')}`
			: baseSlug;

		const id = Identifier.ascending('team');
		return create({ id, name: `${input.displayName}'s Team`, slug });
	});

	/**
	 * Record what the payment provider says a team is on.
	 *
	 * The only writer is the webhook, and it writes both fields together: a plan
	 * without the status it came from cannot say whether "paid" means paying,
	 * cancelled-but-paid-up, or behind on a card, and every one of those wants a
	 * different sentence in front of a person.
	 *
	 * Deliberately not reached from anywhere a user can call. A plan that could
	 * be set by a request is a plan somebody can set on themselves.
	 */
	export const setPlan = fn(
		Info.pick({ id: true }).extend({
			plan: z.string(),
			subscriptionStatus: z.string()
		}),
		async (input) => {
			return Database.use(async (tx) => {
				return tx
					.update(TeamTable)
					.set({ plan: input.plan, subscriptionStatus: input.subscriptionStatus })
					.where(and(eq(TeamTable.id, input.id), isNull(TeamTable.timeDeleted)))
					.returning()
					.then((rows) => {
						const row = rows.at(0);
						return row ? serialize(row) : null;
					});
			});
		}
	);

	/**
	 * What a team's name and slug may be. The slug is the team's address, so
	 * it is what `createPersonal` makes: lowercase letters, digits and single
	 * hyphens. Exported so a client can check before it asks, rather than
	 * keeping a second copy of the rule that drifts.
	 */
	export const Name = z.string().trim().min(1).max(64);
	/**
	 * Slugs a team may not have, because the website serves a team at
	 * `nestri.io/<slug>` and these are its own top-level pages, present or
	 * planned. A team called `pricing` would either shadow the page or be
	 * unreachable, and neither is a thing to discover after someone picked it.
	 */
	export const RESERVED = new Set([
		'about',
		'account',
		'activity',
		'admin',
		'api',
		'app',
		'assets',
		'auth',
		'billing',
		'blog',
		'blogs',
		'boxes',
		'careers',
		'changelog',
		'collab',
		'compare',
		'contact',
		'dashboard',
		'docs',
		'edge',
		'enterprise',
		'games',
		'gaming',
		'help',
		'home',
		'install',
		'installation',
		'legal',
		'login',
		'logout',
		'machines',
		'nesbox',
		'nesgpu',
		'nesktop',
		'neslink',
		'neslite',
		'nessh',
		'nestri',
		'new',
		'pricing',
		'privacy',
		'products',
		'security',
		'settings',
		'signup',
		'static',
		'status',
		'support',
		'team',
		'teams',
		'terms',
		'www'
	]);

	export const Slug = z
		.string()
		.max(50)
		.regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'lowercase letters, numbers and single hyphens')
		.refine((s) => !RESERVED.has(s), 'that name is taken by a page on the site');

	/** A slug somebody else's team already has. */
	export class SlugTaken extends Error {
		constructor(public slug: string) {
			super(`The slug ${slug} is taken`);
		}
	}

	/**
	 * Change a team's name, its slug, or both.
	 *
	 * Who may do this is the caller's business (the route checks the role);
	 * this only refuses a slug that is taken. The check before the write gives
	 * the ordinary answer, and the unique index is what actually holds when two
	 * people race for the same one.
	 */
	export const rename = fn(
		z.object({ id: Info.shape.id, name: Name.optional(), slug: Slug.optional() }),
		async (input) => {
			if (input.slug) {
				const holder = await fromSlug(input.slug);
				if (holder && holder.id !== input.id) throw new SlugTaken(input.slug);
			}
			try {
				return await Database.use(async (tx) =>
					tx
						.update(TeamTable)
						.set({
							...(input.name !== undefined && { name: input.name }),
							...(input.slug !== undefined && { slug: input.slug })
						})
						.where(and(eq(TeamTable.id, input.id), isNull(TeamTable.timeDeleted)))
						.returning()
						.then((rows) => {
							const row = rows.at(0);
							return row ? serialize(row) : null;
						})
				);
			} catch (error) {
				const code = (error as { code?: string; cause?: { code?: string } }) ?? {};
				if (input.slug && (code.code === '23505' || code.cause?.code === '23505')) {
					throw new SlugTaken(input.slug);
				}
				throw error;
			}
		}
	);

	export function serialize(input: typeof TeamTable.$inferSelect): z.infer<typeof Info> {
		return {
			id: input.id,
			name: input.name,
			slug: input.slug,
			ownerId: input.ownerId,
			organisationId: input.organisationId,
			billingEmail: input.billingEmail,
			plan: input.plan,
			subscriptionStatus: input.subscriptionStatus,
			metadata: input.metadata
		};
	}
}
