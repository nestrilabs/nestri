import postgres from 'postgres';

/**
 * Fail-closed test database connection.
 *
 * Tests must never silently fall back to an ad-hoc localhost database, so
 * this throws unless an explicit `TEST_DATABASE_URL` is set. Use an isolated
 * database for tests, e.g.:
 *
 *   TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/nestri
 */
export function testDb() {
	const url = process.env.TEST_DATABASE_URL;
	if (!url) {
		throw new Error(
			'TEST_DATABASE_URL is not set; refusing to run against an unspecified database. ' +
				'Set it to an isolated test database, e.g. ' +
				'TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/nestri'
		);
	}
	// A small pool per test file, deliberately.
	//
	// `postgres` defaults to ten connections, and every test file that calls
	// this opens its own pool alongside the one `Database.use` opens — so at a
	// dozen files the suite asks for more connections than Postgres will give
	// and fails with *"sorry, too many clients already"*, in whichever file
	// happens to run last. Two is plenty: these are sequential fixtures and
	// assertions, not a load test.
	return postgres(url, { max: 2, idle_timeout: 5, connect_timeout: 30 });
}
