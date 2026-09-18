import { beforeEach } from 'bun:test';

import { Env } from '@nestri/core/env';

const TEST_FRONTEND_URL = 'http://localhost:5173';

beforeEach(() => {
	Env.init({
		NODE_ENV: 'test',
		FRONTEND_URL: TEST_FRONTEND_URL
	});
});

export { TEST_FRONTEND_URL };
