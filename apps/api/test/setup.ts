import { beforeEach } from 'bun:test';

import { Env } from '@nestri/core/env';

const TEST_ADMIN_SECRET = 'test-admin-secret-42';
const TEST_FRONTEND_URL = 'http://localhost:5173';

beforeEach(() => {
	Env.init({
		NODE_ENV: 'test',
		ADMIN_SHARED_SECRET: TEST_ADMIN_SECRET,
		FRONTEND_URL: TEST_FRONTEND_URL
	});
});

export { TEST_ADMIN_SECRET, TEST_FRONTEND_URL };
