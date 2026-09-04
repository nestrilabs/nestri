#!/usr/bin/env bash
#
# Prove this migration against a database built to look like the live one,
# rather than against an empty schema.
#
# A migration that only ever runs on a database with no rows in it has
# demonstrated nothing: every statement here that could go wrong goes wrong
# because of what is already in the table. So this builds the awkward rows by
# hand — an account with no address, two accounts sharing one address in
# different cases, an account already over the connection cap, a soft-deleted
# row holding an address a live row also holds — applies every migration
# before this one, then applies this one and checks each of them individually.
#
# Usage: PGHOST=localhost PGPORT=5434 ./verify-migration-0009.sh
set -euo pipefail

PGHOST="${PGHOST:-localhost}"
PGPORT="${PGPORT:-5434}"
PGUSER="${PGUSER:-postgres}"
export PGPASSWORD="${PGPASSWORD:-postgres}"
DB="${DB:-nestri_mig_0009}"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIGRATIONS="$HERE/../migrations"

psql_admin() { psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d postgres -qtA "$@"; }
psql_db() { psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$DB" -qtA -v ON_ERROR_STOP=1 "$@"; }

failures=0
check() { # check <name> <expected> <sql>
	local got
	got="$(psql_db -c "$3" | tr -d '[:space:]')"
	if [ "$got" = "$2" ]; then
		printf 'ok    %s\n' "$1"
	else
		printf 'FAIL  %s — expected %s, got %s\n' "$1" "$2" "$got"
		failures=$((failures + 1))
	fi
}

echo "== rebuilding $DB =="
psql_admin -c "drop database if exists $DB" >/dev/null
psql_admin -c "create database $DB" >/dev/null

echo "== applying everything before it =="
for f in "$MIGRATIONS"/000[0-8]_*.sql; do
	psql_db -f "$f" >/dev/null
	printf '   %s\n' "$(basename "$f")"
done

echo "== seeding rows the way the live database actually looks =="
psql_db >/dev/null <<'SQL'
-- ids are char(30): a four-character prefix and 26 more.
-- A: made by a gaming sign-in, no address at all. The ordinary case today.
insert into "user" (id, name, email, email_verified, time_created) values
	('usr_aaaaaaaaaaaaaaaaaaaaaaaaaa', 'no-email', null, false, now() - interval '10 days');
insert into linked_account (id, user_id, provider, provider_account_id) values
	('lac_aaaaaaaaaaaaaaaaaaaaaaaaaa', 'usr_aaaaaaaaaaaaaaaaaaaaaaaaaa', 'steam', '76561100000000001');

-- B: has both, and the address is stored with the case and spacing a person typed.
insert into "user" (id, name, email, email_verified, time_created) values
	('usr_bbbbbbbbbbbbbbbbbbbbbbbbbb', 'both', '  Ada@Example.COM ', true, now() - interval '9 days');
insert into linked_account (id, user_id, provider, provider_account_id) values
	('lac_bbbbbbbbbbbbbbbbbbbbbbbbbb', 'usr_bbbbbbbbbbbbbbbbbbbbbbbbbb', 'steam', '76561100000000002');

-- C: one person, two gaming accounts. Nothing may touch either.
insert into "user" (id, name, email, email_verified, time_created) values
	('usr_cccccccccccccccccccccccccc', 'two-links', null, false, now() - interval '8 days');
insert into linked_account (id, user_id, provider, provider_account_id) values
	('lac_cc1ccccccccccccccccccccccc', 'usr_cccccccccccccccccccccccccc', 'steam', '76561100000000003'),
	('lac_cc2ccccccccccccccccccccccc', 'usr_cccccccccccccccccccccccccc', 'steam', '76561100000000004');

-- D and E: two accounts on one address, spelled differently. Nothing ever
-- stopped this, so a live database is entitled to contain it.
insert into "user" (id, name, email, email_verified, time_created) values
	('usr_dddddddddddddddddddddddddd', 'older-dup', 'grace@example.com', true, now() - interval '7 days'),
	('usr_eeeeeeeeeeeeeeeeeeeeeeeeee', 'newer-dup', 'GRACE@example.com', true, now() - interval '6 days');
insert into linked_account (id, user_id, provider, provider_account_id) values
	('lac_eeeeeeeeeeeeeeeeeeeeeeeeee', 'usr_eeeeeeeeeeeeeeeeeeeeeeeeee', 'steam', '76561100000000005');

-- F: already over the cap the application is about to start enforcing.
insert into "user" (id, name, email, email_verified, time_created) values
	('usr_ffffffffffffffffffffffffff', 'over-cap', null, false, now() - interval '5 days');
insert into linked_account (id, user_id, provider, provider_account_id) values
	('lac_ff1fffffffffffffffffffffff', 'usr_ffffffffffffffffffffffffff', 'steam', '76561100000000006'),
	('lac_ff2fffffffffffffffffffffff', 'usr_ffffffffffffffffffffffffff', 'steam', '76561100000000007'),
	('lac_ff3fffffffffffffffffffffff', 'usr_ffffffffffffffffffffffffff', 'steam', '76561100000000008'),
	('lac_ff4fffffffffffffffffffffff', 'usr_ffffffffffffffffffffffffff', 'steam', '76561100000000009'),
	('lac_ff5fffffffffffffffffffffff', 'usr_ffffffffffffffffffffffffff', 'steam', '76561100000000010');

-- G: a deleted account still holding an address a live account also holds. The
-- index has to tolerate this or the migration fails on a row nobody can see.
insert into "user" (id, name, email, email_verified, time_created, time_deleted) values
	('usr_gggggggggggggggggggggggggg', 'deleted-dup', 'grace@example.com', true, now() - interval '4 days', now());

-- A run in flight, so the new column lands on a row that already exists.
insert into team (id, name, slug, owner_id) values
	('tem_aaaaaaaaaaaaaaaaaaaaaaaaaa', 'T', 't', 'usr_aaaaaaaaaaaaaaaaaaaaaaaaaa');
insert into team_member (id, team_id, user_id, role) values
	('mem_aaaaaaaaaaaaaaaaaaaaaaaaaa', 'tem_aaaaaaaaaaaaaaaaaaaaaaaaaa', 'usr_aaaaaaaaaaaaaaaaaaaaaaaaaa', 'owner');
insert into machine (id, owner_user_id, team_id, label, secret_hash) values
	('mch_aaaaaaaaaaaaaaaaaaaaaaaaaa', 'usr_aaaaaaaaaaaaaaaaaaaaaaaaaa', 'tem_aaaaaaaaaaaaaaaaaaaaaaaaaa', 'host', 'hash');
insert into game (id, steam_app_id, name, slug) values
	('gam_aaaaaaaaaaaaaaaaaaaaaaaaaa', 730, 'G', 'g');
insert into box (id, user_id, machine_id, label) values
	('box_aaaaaaaaaaaaaaaaaaaaaaaaaa', 'usr_aaaaaaaaaaaaaaaaaaaaaaaaaa', 'mch_aaaaaaaaaaaaaaaaaaaaaaaaaa', 'b');
insert into "session" (id, box_id, game_id, linked_account_id, state) values
	('ses_aaaaaaaaaaaaaaaaaaaaaaaaaa', 'box_aaaaaaaaaaaaaaaaaaaaaaaaaa', 'gam_aaaaaaaaaaaaaaaaaaaaaaaaaa', 'lac_aaaaaaaaaaaaaaaaaaaaaaaaaa', 'live');
SQL

before_users="$(psql_db -c 'select count(*) from "user"')"
before_links="$(psql_db -c 'select count(*) from linked_account')"
echo "   $before_users users, $before_links connected accounts"

echo "== applying the migration under test =="
psql_db -f "$MIGRATIONS/0009_email_is_the_root_identity.sql" >/dev/null
echo "   0009_email_is_the_root_identity.sql"

echo "== checking =="
check "no account was deleted" "$before_users" 'select count(*) from "user"'
check "no connection was deleted" "$before_links" 'select count(*) from linked_account'

check "A: an account with no address is untouched" "t" \
	"select email is null and email_verified = false from \"user\" where id = 'usr_aaaaaaaaaaaaaaaaaaaaaaaaaa'"
check "A: its connected account survives" "1" \
	"select count(*) from linked_account where user_id = 'usr_aaaaaaaaaaaaaaaaaaaaaaaaaa'"

check "B: the address is normalized in place" "ada@example.com" \
	"select email from \"user\" where id = 'usr_bbbbbbbbbbbbbbbbbbbbbbbbbb'"
check "B: it stays verified" "t" \
	"select email_verified from \"user\" where id = 'usr_bbbbbbbbbbbbbbbbbbbbbbbbbb'"

check "C: two connected accounts are still two" "2" \
	"select count(*) from linked_account where user_id = 'usr_cccccccccccccccccccccccccc'"

check "D: the older of the pair keeps the address" "grace@example.com" \
	"select email from \"user\" where id = 'usr_dddddddddddddddddddddddddd'"
check "D: and stays verified" "t" \
	"select email_verified from \"user\" where id = 'usr_dddddddddddddddddddddddddd'"
check "E: the newer one loses it and is asked again" "t" \
	"select email is null and email_verified = false from \"user\" where id = 'usr_eeeeeeeeeeeeeeeeeeeeeeeeee'"
check "E: but keeps its account and its connection" "1" \
	"select count(*) from linked_account where user_id = 'usr_eeeeeeeeeeeeeeeeeeeeeeeeee'"

check "F: an account already over the cap is left alone" "5" \
	"select count(*) from linked_account where user_id = 'usr_ffffffffffffffffffffffffff'"

check "G: a deleted row may keep a live row's address" "grace@example.com" \
	"select email from \"user\" where id = 'usr_gggggggggggggggggggggggggg'"

check "the index exists" "1" \
	"select count(*) from pg_indexes where indexname = 'user_email_unique'"
# If the insert is allowed, the raise below is not a unique_violation, so it is
# not caught, and psql stops on it — which reads as a failure rather than a pass.
check "and a second live account cannot take a taken address" "refused" \
	"do \$\$ begin
		insert into \"user\" (id, name, email) values ('usr_zzzzzzzzzzzzzzzzzzzzzzzzzz', 'z', 'grace@example.com');
		raise exception 'the index allowed a duplicate address';
	exception when unique_violation then null;
	end \$\$; select 'refused'"

check "the claim column is there" "1" \
	"select count(*) from information_schema.columns where table_name = 'session' and column_name = 'claim_token'"
check "the claim column is nullable" "YES" \
	"select is_nullable from information_schema.columns where table_name = 'session' and column_name = 'claim_token'"
check "the claim column has no default" "1" \
	"select count(*) from information_schema.columns where table_name = 'session' and column_name = 'claim_token' and column_default is null"
check "and nothing was backfilled into it" "1" \
	"select count(*) from \"session\" where claim_token is null"

echo
if [ "$failures" -eq 0 ]; then
	echo "all checks passed"
else
	echo "$failures check(s) failed"
	exit 1
fi
