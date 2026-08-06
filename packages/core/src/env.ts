import { z } from 'zod';

import { memo } from './utils/memo.js';

let _overrides: Record<string, unknown> = {};

export namespace Env {
	export const Info = z.object({
		NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

		STEAM_API_KEY: z.string().optional(),

		AUTH_ISSUER_URL: z.string().optional(),

		SSH_AUTH_KEY: z.string().optional(),

		ADMIN_SHARED_SECRET: z.string().optional(),

		DATABASE_URL: z.string().optional()
	});

	export type Info = z.infer<typeof Info>;

	const _get = memo(() => Info.parse({ ...process.env, ..._overrides }));

	export function get(): Info {
		return _get();
	}

	export function init(bindings: Record<string, unknown>) {
		_overrides = {
			...bindings,
			...(bindings.HYPERDRIVE
				? {
						DATABASE_URL: (bindings.HYPERDRIVE as { connectionString: string }).connectionString
					}
				: {})
		};
		_get.reset();
	}
}
