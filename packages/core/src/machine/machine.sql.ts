import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';

import { id, timestamps, ulid, utc } from '../db/types.js';
import { OrganisationTable } from '../organisation/organisation.sql.js';
import { TeamTable } from '../team/team.sql.js';
import { UserTable } from '../user/user.sql.js';

/**
 * A registered host — the *box* that runs downloads and serves SSH, not the
 * laptop someone connects from. Note the word is used the other way round in
 * some client-facing writing, where "machine" is the end a person sits at;
 * this table is the host end.
 *
 * A box does not assert who it is. It registers once against an owner's token
 * and is handed an id and a secret, so ids are unique because the API assigns
 * them rather than because a self-reported string happened not to collide.
 *
 * **Hardware is owned one of two ways, and never both.** Someone brings their
 * own and reaches it through a team; or an organisation owns it outright, to
 * serve workloads for people who have no hardware of their own. The check
 * constraint below is what keeps that an either/or rather than a convention.
 */
export const MachineTable = pgTable(
	'machine',
	{
		...id,
		...timestamps,
		/**
		 * Who registered it, when a person did.
		 *
		 * Null for hardware an organisation owns, which is the whole point of
		 * the column being nullable: a company's card is not anybody's personal
		 * property, and parking it under whichever employee ran the command
		 * made it one — where `cascade` below meant deleting that account
		 * deleted the machine.
		 *
		 * `cascade` stays, and is right once null is available. It only ever
		 * fires for a host somebody brought, and a box dying with the account
		 * that owns it is the behaviour that account expects. Fleet hardware is
		 * never reached by it, because the column it would follow is null.
		 */
		ownerUserId: ulid('owner_user_id').references(() => UserTable.id, {
			onDelete: 'cascade'
		}),
		// A team's own hardware, brought by one of its members. Every user gets
		// a personal team at signup, so there is always one to point at and the
		// single-operator case is a team of one rather than a special case in
		// every query. ref(d-0048)
		//
		// Null exactly when `organisationId` is set; see the check below.
		teamId: ulid('team_id').references(() => TeamTable.id, { onDelete: 'restrict' }),
		/**
		 * The organisation that owns this host outright.
		 *
		 * Set for fleet hardware and null for everything else. Deliberately not
		 * reached through a team: a team's machines belong to that team, and
		 * putting the fleet in a team would make every query that asks "whose
		 * hardware is this?" answer with a team that does not pay for it and
		 * cannot be billed for it.
		 */
		organisationId: ulid('organisation_id').references(() => OrganisationTable.id, {
			onDelete: 'restrict'
		}),
		label: text('label').notNull(),
		// The name this host is reached at: `amber-otter-4821.nestri.link`.
		//
		// Separate from `label`, which is what its owner calls it in a list and
		// is theirs to duplicate or leave blank-ish. This one is a routing key,
		// unique across the fleet, and the edge matches a Host header against
		// it.
		//
		// **Not the id, on purpose.** Ids here are monotonic, so an id in a
		// hostname discloses when a machine was registered and its order among
		// its owner's others; the id is the primary key, so a name that has to
		// change could only change by re-registering the machine; and the
		// hostname is also the OAuth audience, which puts whatever is in it
		// into redirect URLs and browser history. ref(d-0019)
		slug: text('slug').notNull(),
		// Where this host can actually be reached: its own endpoint id, as
		// hex. A row can be authorised perfectly and still have nowhere to
		// send the request without it, which is what this column fixes.
		//
		// **Reported, never assigned.** A host holds the secret half and is
		// the only thing that can know the public one first, so the control
		// plane records what it is told rather than handing one out. ref(d-0010)
		//
		// Nullable because a host that has never reported one is a real state
		// — every host registered before this column existed is in it — and
		// the honest reading of null is "not reachable yet" rather than a
		// default that would route somewhere wrong. Unique because an endpoint
		// id belongs to one host: two rows claiming the same one would send a
		// request addressed to one machine to a different machine's agent.
		endpointId: text('endpoint_id'),
		// The secret itself is returned exactly once, at registration, and never
		// stored: a leaked database must not yield working box credentials.
		secretHash: text('secret_hash').notNull(),
		lastSeen: utc('last_seen')
	},
	(t) => [
		uniqueIndex('machine_secret_hash_unique').on(t.secretHash),
		// One name, one machine. This is also the whole of "the two key spaces
		// must not collide" while machines are the only things with names --
		// when boxes get theirs, the two have to share one index rather than
		// hold one each.
		uniqueIndex('machine_slug_unique').on(t.slug),
		uniqueIndex('machine_endpoint_id_unique').on(t.endpointId),
		index('machine_owner_idx').on(t.ownerUserId),
		index('machine_team_idx').on(t.teamId),
		index('machine_organisation_idx').on(t.organisationId),
		// Exactly one owner, enforced here rather than in the code that writes
		// rows. Both null is a host nobody owns and nothing can bill; both set
		// is two answers to one question, and whichever one a given query
		// happens to join through would decide who pays.
		check('machine_one_owner', sql`(${t.teamId} is null) != (${t.organisationId} is null)`)
	]
);
