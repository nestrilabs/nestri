-- The issuer's own state, moved out of a key-value store.
--
-- It used to live entirely behind one get/set/remove/scan interface, which is
-- what a library that has to run on any hosting provider's cache can offer.
-- Three of the things kept there could not actually be served by it.
--
-- `authorization_code` and `refresh_token` each have a transition that must
-- happen exactly once while two callers are touching the same record: a code
-- is redeemed once, a refresh token is spent once. Through get and set, the
-- check and the write are separate, so two requests arriving together both
-- read an unspent record and both mint a session — and in the refresh case the
-- reuse that reveals a stolen token is never recorded. Here redeeming is one
-- `delete ... returning` and spending is one
-- `update ... where time_used is null returning *`, so exactly one caller is
-- told it went first.
--
-- `auth_key` is here for a different reason: it is the one record whose loss
-- ends every session at once, and a cache is a place things are allowed to be
-- evicted from. It gets a conditional write too, though. At most one key of a
-- kind may be live, which `auth_key_one_live_per_kind` enforces rather than
-- leaving to convention — without it, two workers starting against an empty
-- table both find no key, both insert one, and each then signs and encrypts
-- with its own. A session cookie written by one is undecryptable to the other
-- and a token minted by one is rejected by the other, because both reach for a
-- single key rather than trying the whole published set. The split is silent
-- until someone cannot sign in. With the index the second insert is dropped and
-- both workers use the key that won.
--
-- Keys are retired by setting `expired_at`, never deleted, so a verifier
-- reading the published JWKS can still check a token signed before a rotation.
-- Retiring one and creating its replacement have to happen together, so the
-- kind never has two live keys and never has none.
--
-- Both credential tables store a hash and never the credential. An
-- authorization code travels in a query string and a refresh token resumes a
-- session, so what is kept is enough to recognise one and not enough to
-- present it.
--
-- `auth_kv` is what is left, and is meant to stay small: the counters behind
-- the device-code guess limit and the sign-in code retry limit. They are
-- written far more often than read, meaningless within the hour, and allowed
-- to be approximate — a lost increment costs one extra guess out of ten. That
-- is the one case where an unmigrated `jsonb` blob is the right answer rather
-- than a shortcut.
--
-- No sweeper anywhere. Every table is swept by the statement that adds to it,
-- which is enough because each is bounded by how many sign-ins are in flight.

CREATE TYPE "public"."auth_key_kind" AS ENUM('signing', 'encryption');--> statement-breakpoint
CREATE TABLE "authorization_code" (
	"id" char(30) PRIMARY KEY NOT NULL,
	"time_created" timestamp with time zone DEFAULT now() NOT NULL,
	"time_updated" timestamp with time zone DEFAULT now() NOT NULL,
	"time_deleted" timestamp with time zone,
	"code_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"payload" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "refresh_token" (
	"id" char(30) PRIMARY KEY NOT NULL,
	"time_created" timestamp with time zone DEFAULT now() NOT NULL,
	"time_updated" timestamp with time zone DEFAULT now() NOT NULL,
	"time_deleted" timestamp with time zone,
	"subject" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"time_used" timestamp with time zone,
	"payload" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_key" (
	"id" char(30) PRIMARY KEY NOT NULL,
	"time_created" timestamp with time zone DEFAULT now() NOT NULL,
	"time_updated" timestamp with time zone DEFAULT now() NOT NULL,
	"time_deleted" timestamp with time zone,
	"key_id" text NOT NULL,
	"kind" "auth_key_kind" NOT NULL,
	"alg" text NOT NULL,
	"public_key" text NOT NULL,
	"private_key" text NOT NULL,
	"expired_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "auth_kv" (
	"id" char(30) PRIMARY KEY NOT NULL,
	"time_created" timestamp with time zone DEFAULT now() NOT NULL,
	"time_updated" timestamp with time zone DEFAULT now() NOT NULL,
	"time_deleted" timestamp with time zone,
	"key" text NOT NULL,
	"value" jsonb NOT NULL,
	"expires_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX "authorization_code_hash_unique" ON "authorization_code" USING btree ("code_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "refresh_token_hash_unique" ON "refresh_token" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "refresh_token_subject_idx" ON "refresh_token" USING btree ("subject");--> statement-breakpoint
CREATE UNIQUE INDEX "auth_key_key_id_unique" ON "auth_key" USING btree ("key_id");--> statement-breakpoint
CREATE UNIQUE INDEX "auth_key_one_live_per_kind" ON "auth_key" USING btree ("kind") WHERE "auth_key"."expired_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "auth_kv_key_unique" ON "auth_kv" USING btree ("key");