-- That a host holds a Steam refresh token for a user — and never the token.
--
-- The auth session begins on the machine that will use the credential, so the
-- token is written on that host, encrypted, under that host's own account, and
-- it never travels back. What travels back is the outcome, and this table is
-- where the outcome is kept. ref(d-0004)
--
-- **There is no token column and there must never be one**, including a
-- nullable "encrypted token" that looks harmless while empty. The protection
-- here is not that the column is guarded; it is that the credential is never
-- sent to this database at all, and a column able to hold one is the first step
-- in undoing that. The same applies to the challenge URL and client id the
-- sign-in flow uses: they live for about two minutes inside one process and
-- nothing outside it needs them.
--
-- `steam_id` is not unique, on purpose. One Steam account signed in on two
-- hosts is two rows and two tokens, because each token is bound to the address
-- that asked for it — that binding is the anti-theft signal, and sharing one
-- token between hosts is the thing it fires on. A unique index here would read
-- as hygiene and would refuse a person their second box.
--
-- The key is the pair. An enrolment is a fact about this user on this host and
-- there is exactly one such fact, so the row carries no surrogate id. It also
-- carries no `time_deleted`: the three states are the lifecycle, and the row
-- itself only goes away when the machine or the user does, which the foreign
-- keys already do.
--
-- The key begins with the machine, so it answers "what does this host hold" and
-- nothing else. `user_id` gets its own index because the two things that read
-- by user cannot use the key: deleting a user cascades into this table by that
-- column alone, and asking which hosts hold a token for one person is the
-- obvious next reader.
--
-- `last_ok_at` has no writer yet. A successful logon happens inside the
-- workload, which holds no control-plane credential, so the report has to come
-- back out through the host and nothing carries it today. The column exists
-- with the shape it will need and stays null rather than being filled with the
-- nearest event that was easy to observe.

CREATE TYPE "public"."steam_enrolment_state" AS ENUM('enrolled', 'stale', 'revoked');--> statement-breakpoint
CREATE TABLE "steam_enrolment" (
	"machine_id" char(30) NOT NULL,
	"user_id" char(30) NOT NULL,
	"steam_id" text NOT NULL,
	"state" "steam_enrolment_state" NOT NULL,
	"enrolled_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_ok_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "steam_enrolment_machine_id_user_id_pk" PRIMARY KEY("machine_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "steam_enrolment" ADD CONSTRAINT "steam_enrolment_machine_id_machine_id_fk" FOREIGN KEY ("machine_id") REFERENCES "public"."machine"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "steam_enrolment" ADD CONSTRAINT "steam_enrolment_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "steam_enrolment_user_idx" ON "steam_enrolment" USING btree ("user_id");