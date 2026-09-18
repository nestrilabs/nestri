-- Hardware an organisation owns, rather than a person.
--
-- Two kinds of machine were being modelled as one. A host somebody brings is
-- theirs, reached through a team, and should die with their account. A host
-- bought to serve other people's workloads is none of those things, and until
-- now it had to be registered under some employee's personal team -- so the
-- company's card was that employee's personal property, and their account
-- going away took it. ref(d-0048)
--
-- So ownership becomes an either/or. `team_id` for a host somebody brought,
-- `organisation_id` for one a company owns outright, exactly one of them set,
-- and a check constraint rather than a convention -- because both null is a
-- host nothing can bill, and both set is two answers to "whose is this?" where
-- whichever join a query happens to take would decide who pays.
--
-- `owner_user_id` becomes nullable so that fleet hardware can have no person
-- behind it at all. Its ON DELETE CASCADE is deliberately left alone: it now
-- only ever fires for a host somebody brought, where a box dying with its
-- owner's account is what that owner expects, and it cannot reach fleet
-- hardware because the column it follows is null there.
--
-- Note the check is safe to apply in one step. Every existing row has a team
-- and no organisation, so all of them already satisfy it -- which is only true
-- because `team_id` was NOT NULL before this migration relaxed it.
--
-- `organisation.domain` is what makes someone a member, and membership is
-- derived from it rather than stored: an address is already the root identity,
-- so a second record of who belongs where is a second answer that can disagree
-- with the first. `domain_verified` defaults false because an unverified claim
-- is a string somebody typed, and nothing may be granted on one.
--
-- The organisation deliberately has no plan or subscription columns. It says
-- who owns the metal, not who owes money; a team pays for what it uses whether
-- it sits under an organisation or not.

CREATE TABLE "organisation" (
	"id" char(30) PRIMARY KEY NOT NULL,
	"time_created" timestamp with time zone DEFAULT now() NOT NULL,
	"time_updated" timestamp with time zone DEFAULT now() NOT NULL,
	"time_deleted" timestamp with time zone,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"domain" text NOT NULL,
	"domain_verified" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
ALTER TABLE "machine" ALTER COLUMN "owner_user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "machine" ALTER COLUMN "team_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "machine" ADD COLUMN "organisation_id" char(30);--> statement-breakpoint
ALTER TABLE "team" ADD COLUMN "organisation_id" char(30);--> statement-breakpoint
CREATE UNIQUE INDEX "organisation_slug_unique" ON "organisation" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "organisation_domain_unique" ON "organisation" USING btree ("domain");--> statement-breakpoint
ALTER TABLE "machine" ADD CONSTRAINT "machine_organisation_id_organisation_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisation"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team" ADD CONSTRAINT "team_organisation_id_organisation_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisation"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "machine_organisation_idx" ON "machine" USING btree ("organisation_id");--> statement-breakpoint
CREATE INDEX "team_organisation_idx" ON "team" USING btree ("organisation_id");--> statement-breakpoint
ALTER TABLE "machine" ADD CONSTRAINT "machine_one_owner" CHECK (("machine"."team_id" is null) != ("machine"."organisation_id" is null));