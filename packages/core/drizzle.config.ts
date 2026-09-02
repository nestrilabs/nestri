import { defineConfig } from 'drizzle-kit';

const url = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : null;

/**
 * Whether to speak TLS, decided by the connection string rather than by
 * whether one exists.
 *
 * The previous form was `ssl: !!process.env.DATABASE_URL ? { rejectUnauthorized:
 * false } : false`, which turned TLS on for *any* `DATABASE_URL` — so it failed
 * against every plain Postgres, including CI's own `postgres:18-alpine` service
 * container, and `drizzle-kit` reports that failure as a spinner and a non-zero
 * exit with no message attached. Measured 2026-09-02: with the URL set,
 * migrations fail silently; with it unset against the same database, all seven
 * apply.
 */
function sslFor(u: URL | null): false | { rejectUnauthorized: boolean } {
	if (!u) return false;

	// An explicit sslmode in the URL wins, always.
	const mode = u.searchParams.get('sslmode');
	if (mode) {
		if (mode === 'disable') return false;
		return { rejectUnauthorized: mode === 'verify-full' };
	}

	// Otherwise infer: a local Postgres does not speak TLS at all, and a hosted
	// one nearly always does — usually behind a chain we have no root for.
	const local = ['localhost', '127.0.0.1', '::1', ''].includes(u.hostname);
	return local ? false : { rejectUnauthorized: false };
}

export default defineConfig({
	verbose: true,
	strict: true,
	out: './migrations',
	dialect: 'postgresql',
	schema: './src/**/*.sql.ts',
	dbCredentials: {
		host: url?.hostname || 'localhost',
		port: Number(url?.port || 5432),
		user: url?.username || 'postgres',
		password: url?.password || 'postgres',
		database: url?.pathname.slice(1) || 'nestri',
		ssl: sslFor(url)
	}
});
