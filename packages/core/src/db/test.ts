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
	return postgres(url, { idle_timeout: 30, connect_timeout: 30 });
}
