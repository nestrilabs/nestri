/**
 * The API as an ordinary HTTP server.
 *
 * `index.ts` exports a handler taking `(request, env)` — the shape a Worker is
 * invoked with, and also the shape of a plain function from a request to a
 * response. So there is nothing here but the loop that calls it: the process
 * environment stands in for the bindings, and a port stands in for the route.
 *
 * With no `AUTH` binding in that environment the middleware reaches the issuer
 * over plain HTTP at `AUTH_ISSUER_URL`, which is a setting this deployment has
 * either way. Nothing else differs.
 */
import handler, { type ApiEnv } from './index.js';

const port = Number(process.env.PORT ?? 3000);

Bun.serve({
	port,
	hostname: '0.0.0.0',
	// A Worker runtime hands the handler a context whose `waitUntil` keeps the
	// invocation alive past the response. A process does not need convincing to
	// stay alive, so the equivalent is to let the promise run — with a catch,
	// because an unobserved rejection here would take the server down rather
	// than the request that caused it.
	fetch: (request) =>
		handler.fetch(
			request,
			process.env as unknown as ApiEnv,
			{
				waitUntil: (promise: Promise<unknown>) => {
					void Promise.resolve(promise).catch((error: unknown) => {
						console.error('[api] background task failed:', error);
					});
				},
				passThroughOnException: () => {}
			} as unknown as ExecutionContext
		)
});

console.log(`[api] listening on http://0.0.0.0:${port}`);
