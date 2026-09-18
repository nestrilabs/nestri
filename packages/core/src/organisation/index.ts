import { and, eq, isNull, sql } from 'drizzle-orm';
import z from 'zod';

import { Database } from '../db/index.js';
import { Examples } from '../examples.js';
import { fn } from '../fn.js';
import { UserTable } from '../user/user.sql.js';
import { OrganisationTable } from './organisation.sql.js';

export namespace Organisation {
	export const Info = z
		.object({
			id: z.string().meta({
				description: 'Unique identifier for the organisation',
				example: Examples.Organisation.id
			}),
			name: z.string().meta({
				description: 'Display name of the organisation',
				example: Examples.Organisation.name
			}),
			slug: z.string().meta({
				description: 'URL-friendly unique slug for the organisation',
				example: Examples.Organisation.slug
			}),
			domain: z.string().meta({
				description:
					'The email domain whose verified addresses belong to this organisation, without an @',
				example: Examples.Organisation.domain
			}),
			domainVerified: z.boolean().meta({
				description:
					'Whether the domain has been shown to belong to them. Nothing is granted on an unverified claim',
				example: Examples.Organisation.domainVerified
			})
		})
		.meta({
			ref: 'Organisation',
			description:
				'A company. It owns hardware outright, rather than through a team, and gathers the teams whose members sign in with its domain.',
			example: Examples.Organisation
		});

	export type Info = z.infer<typeof Info>;

	/**
	 * The domain part of an address, lower-cased.
	 *
	 * Returns null for anything that is not one address with one `@`, because
	 * every caller here is about to use the answer to decide membership and a
	 * best guess at a malformed address is the wrong kind of helpful.
	 */
	export function domainOf(email: string | null | undefined): string | null {
		if (!email) {
			return null;
		}
		const parts = email.trim().toLowerCase().split('@');
		if (parts.length !== 2 || !parts[0] || !parts[1]) {
			return null;
		}
		return parts[1]!;
	}

	export const create = fn(
		Info.pick({ id: true, name: true, slug: true, domain: true }).extend({
			domainVerified: Info.shape.domainVerified.optional()
		}),
		async (input) => {
			await Database.use(async (tx) => {
				await tx.insert(OrganisationTable).values({
					id: input.id,
					name: input.name,
					slug: input.slug,
					domain: input.domain.trim().toLowerCase(),
					domainVerified: input.domainVerified ?? false
				});
			});
			return input.id;
		}
	);

	export const fromID = fn(Info.shape.id, async (id) => {
		return Database.use(async (tx) => {
			return tx
				.select()
				.from(OrganisationTable)
				.where(and(eq(OrganisationTable.id, id), isNull(OrganisationTable.timeDeleted)))
				.then((rows) => {
					const row = rows.at(0);
					return row ? serialize(row) : null;
				});
		});
	});

	export const fromSlug = fn(Info.shape.slug, async (slug) => {
		return Database.use(async (tx) => {
			return tx
				.select()
				.from(OrganisationTable)
				.where(and(eq(OrganisationTable.slug, slug), isNull(OrganisationTable.timeDeleted)))
				.then((rows) => {
					const row = rows.at(0);
					return row ? serialize(row) : null;
				});
		});
	});

	/**
	 * The organisation a domain belongs to, if one has proved it does.
	 *
	 * Only ever answers with a *verified* domain. An unverified row is a claim
	 * anybody could have typed, and answering with it would let whoever typed
	 * `gmail.com` reach every account on it.
	 */
	export const fromVerifiedDomain = fn(Info.shape.domain, async (domain) => {
		const normalized = domain.trim().toLowerCase();
		return Database.use(async (tx) => {
			return tx
				.select()
				.from(OrganisationTable)
				.where(
					and(
						eq(OrganisationTable.domain, normalized),
						eq(OrganisationTable.domainVerified, true),
						isNull(OrganisationTable.timeDeleted)
					)
				)
				.then((rows) => {
					const row = rows.at(0);
					return row ? serialize(row) : null;
				});
		});
	});

	/**
	 * Which organisation a user belongs to, derived rather than stored.
	 *
	 * Membership is their verified address's domain matching a verified
	 * organisation domain, and there is no membership table on purpose: an
	 * address is already the root identity, so a second record of who belongs
	 * where is a second answer that can disagree with the first.
	 *
	 * Two consequences worth stating, because both are features here. Signing
	 * in with a personal address gets an ordinary personal account, which is
	 * what lets the same person hold a company account and use the consumer
	 * product. And a user belongs to at most one organisation — when someone
	 * needs to be in two, this is where a membership table goes, and until then
	 * it would be a table with one row per user saying what the address says.
	 *
	 * An unverified address is not membership. It is a string somebody typed.
	 */
	export const forUser = fn(z.string(), async (userId) => {
		const user = await Database.use(async (tx) => {
			return tx
				.select({ email: UserTable.email, emailVerified: UserTable.emailVerified })
				.from(UserTable)
				.where(and(eq(UserTable.id, userId), isNull(UserTable.timeDeleted)))
				.then((rows) => rows.at(0) ?? null);
		});
		if (!user?.emailVerified) {
			return null;
		}
		const domain = domainOf(user.email);
		if (!domain) {
			return null;
		}
		return fromVerifiedDomain(domain);
	});

	/** Whether this user may act for this organisation. */
	export async function isMember(userId: string, organisationId: string): Promise<boolean> {
		const organisation = await forUser(userId);
		return organisation?.id === organisationId;
	}

	export const remove = fn(Info.shape.id, async (id) => {
		await Database.use(async (tx) => {
			await tx
				.update(OrganisationTable)
				.set({ timeDeleted: sql`now()` })
				.where(eq(OrganisationTable.id, id));
		});
	});

	export function serialize(input: typeof OrganisationTable.$inferSelect): Info {
		return {
			id: input.id,
			name: input.name,
			slug: input.slug,
			domain: input.domain,
			domainVerified: input.domainVerified
		};
	}
}
