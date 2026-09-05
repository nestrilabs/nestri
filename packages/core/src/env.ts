import { z } from 'zod';

import { memo } from './utils/memo.js';

let _overrides: Record<string, unknown> = {};

export namespace Env {
	export const Info = z.object({
		NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

		AUTH_ISSUER_URL: z.string().optional(),

		/**
		 * Where to *reach* the issuer, when that is not where it *lives*.
		 *
		 * `AUTH_ISSUER_URL` is an identity: a token carries the address it was
		 * minted through and verification compares the two literally, so it is
		 * the public name and can be nothing else. But the public name is
		 * often not routable from inside a deployment — a container on a
		 * private network, a host behind its own proxy — and one setting
		 * cannot be both.
		 *
		 * So this one is the route and the other is the name, which is the
		 * same split a service binding makes on its own: the binding is the
		 * route, and the `iss` claim is still the name. Unset means they are
		 * the same address, which is the ordinary case.
		 */
		AUTH_INTERNAL_URL: z.string().optional(),

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
