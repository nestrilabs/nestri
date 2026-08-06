import { Database } from '@nestri/core/db/index';
import { ErrorCodes, VisibleError } from '@nestri/core/error';
import { Hono } from 'hono';

export namespace IndexApi {
	export const route = new Hono()
		.get('/', (c) => c.text('Hello World!'))
		.get('/health', async (c) => {
			const ok = await Database.ping();
			if (!ok) {
				throw new VisibleError(
					'internal',
					ErrorCodes.Server.DEPENDENCY_FAILURE,
					'Database connection failed'
				);
			}
			return c.json({ status: 'ok' });
		});
}
