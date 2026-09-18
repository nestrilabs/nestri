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

		/**
		 * Burn allowances per plan, as JSON. Unset takes the placeholder set.
		 *
		 * Configuration rather than constants because these are retuned against
		 * real burn far more often than the code that reads them changes, and a
		 * rate that needs a deploy is a rate that stays wrong until the next one.
		 */
		BURN_LIMITS: z.string().optional(),

		/**
		 * The payment provider.
		 *
		 * `POLAR_SERVER` picks the instance and the two are entirely separate
		 * servers with separate data, so a token from one is refused by the
		 * other and a product id from one means nothing to it. Getting this
		 * wrong fails loudly rather than quietly charging somebody.
		 */
		POLAR_ACCESS_TOKEN: z.string().optional(),
		POLAR_WEBHOOK_SECRET: z.string().optional(),
		POLAR_PRODUCT_ID: z.string().optional(),
		POLAR_SERVER: z.enum(['sandbox', 'production']).optional(),

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
