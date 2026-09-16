/**
 * The migrator, as a binary.
 *
 *   nestri-migrate            apply everything pending
 *   nestri-migrate --check    say what is pending, change nothing
 *
 * The deploy agent runs this **before** it swaps the new release into place,
 * which is what makes the additive-only rule load-bearing: a rollback moves
 * code and never schema, so every migration has to be readable by the release
 * it is replacing. Add a column, deploy, stop writing the old one, drop it in
 * a later release — never in the same one.
 *
 * The bookkeeping is deliberately identical to `drizzle-orm`'s own
 * `PgDialect.migrate`, down to the table, the schema and the high-water-mark
 * comparison, because this database was first migrated by `drizzle-kit` and
 * both must agree about what has already run. Verified 2026-09-17 against the
 * live database: all fourteen hashes and timestamps match to the byte.
 *
 * It talks to Postgres directly rather than through `drizzle-orm` — this is
 * thirty lines of SQL, and the version that goes near production schema should
 * be the one you can read in full.
 */
import postgres from 'postgres';

import { MIGRATIONS } from './migrations.generated.js';

const SCHEMA = 'drizzle';
const TABLE = '__drizzle_migrations';

async function main() {
	const check = process.argv.includes('--check');

	const url = process.env.DATABASE_URL;
	if (!url) {
		console.error('nestri-migrate: DATABASE_URL is not set');
		process.exit(2);
	}

	// One connection, and no idle timeout worth the name: this process exists
	// for a few seconds and then stops.
	const sql = postgres(url, {
		max: 1,
		idle_timeout: 5,
		connect_timeout: 30,
		// `CREATE ... IF NOT EXISTS` raises a NOTICE every single run, and
		// postgres-js prints the whole struct by default -- so the steady state
		// of this binary was eighteen lines of noise around one line of fact.
		// Errors are unaffected; they are thrown, not noticed.
		onnotice: () => {}
	});

	try {
		await sql.unsafe(`CREATE SCHEMA IF NOT EXISTS "${SCHEMA}"`);
		await sql.unsafe(`
			CREATE TABLE IF NOT EXISTS "${SCHEMA}"."${TABLE}" (
				id SERIAL PRIMARY KEY,
				hash text NOT NULL,
				created_at bigint
			)
		`);

		const rows = await sql.unsafe(
			`select id, hash, created_at from "${SCHEMA}"."${TABLE}" order by created_at desc limit 1`
		);
		const last = rows[0] ? Number(rows[0].created_at) : null;

		// A high-water mark, not a set of hashes. That is drizzle's rule and
		// changing it here would make the two disagree about a migration that
		// was applied out of order.
		const pending = MIGRATIONS.filter((m) => last === null || last < m.folderMillis);

		if (pending.length === 0) {
			console.log(`nestri-migrate: nothing to do (${MIGRATIONS.length} applied)`);
			return;
		}

		if (check) {
			console.log(`nestri-migrate: ${pending.length} pending`);
			for (const m of pending) console.log(`  ${m.tag}`);
			return;
		}

		// All of them in one transaction, as drizzle does. Postgres has
		// transactional DDL, so a failure half way through leaves the schema
		// exactly as it was rather than half-migrated with a release about to
		// be swapped in on top of it.
		await sql.begin(async (tx) => {
			for (const m of pending) {
				console.log(`nestri-migrate: applying ${m.tag}`);
				for (const stmt of m.sql) {
					if (stmt.trim() === '') continue;
					await tx.unsafe(stmt);
				}
				await tx.unsafe(
					`insert into "${SCHEMA}"."${TABLE}" ("hash", "created_at") values($1, $2)`,
					[m.hash, m.folderMillis]
				);
			}
		});

		console.log(`nestri-migrate: applied ${pending.length}`);
	} finally {
		await sql.end();
	}
}

main().catch((err) => {
	// Non-zero and loud. The agent refuses to swap the release in when this
	// fails, so the thing that matters most is that it cannot fail quietly.
	console.error('nestri-migrate: failed');
	console.error(err);
	process.exit(1);
});
