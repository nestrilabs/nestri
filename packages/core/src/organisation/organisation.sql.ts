import { boolean, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';

import { id, timestamps } from '../db/types.js';

/**
 * A company, and the owner of hardware that belongs to nobody in particular.
 *
 * It exists because two kinds of machine were being modelled as one. A host
 * somebody brings is theirs, reached through a team, and dies with their
 * account — which is right. A host bought to serve other people's workloads is
 * none of those things, and until now it had to be registered under some
 * employee's personal team, where a deleted user row would take it with it.
 *
 * So an organisation owns fleet hardware *directly* rather than through a team
 * inside it. Those are different relationships and collapsing them was the
 * bug: a team's hardware is the team's, and the fleet is the company's.
 *
 * **Not a billing subject.** A team pays for what it uses whether it belongs
 * to an organisation or not, so there are deliberately no plan or subscription
 * columns here — this row says who owns the metal, not who owes money.
 */
export const OrganisationTable = pgTable(
	'organisation',
	{
		...id,
		...timestamps,
		name: text('name').notNull(),
		slug: text('slug').notNull(),
		/**
		 * The email domain that makes someone a member, without an `@`.
		 *
		 * Membership is derived from this rather than stored: an address is
		 * already the root identity, and one verified domain answers "who
		 * belongs here?" without a table that can disagree with it. Someone
		 * signing in with a personal address gets their ordinary personal
		 * account, which is what makes it safe to dogfood the company account
		 * and the consumer product from the same machine.
		 *
		 * Lower-cased and unique, for the same reason a user's address is: two
		 * organisations claiming one domain would make membership ambiguous in
		 * exactly the case that matters. Nothing here enforces the case, so
		 * anything writing it has to normalize first.
		 */
		domain: text('domain').notNull(),
		/**
		 * Whether the domain has been shown to belong to them.
		 *
		 * Separate from the domain itself because an unverified claim is a real
		 * state and must never grant anything: anyone can type `gmail.com`, and
		 * membership derived from an unchecked claim would hand them every
		 * account on it. Nothing verifies domains yet, so this is set by hand
		 * and read by everything that grants.
		 */
		domainVerified: boolean('domain_verified').notNull().default(false)
	},
	(t) => [
		uniqueIndex('organisation_slug_unique').on(t.slug),
		uniqueIndex('organisation_domain_unique').on(t.domain)
	]
);
