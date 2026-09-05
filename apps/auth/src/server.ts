/**
 * The issuer as an ordinary HTTP server.
 *
 * `index.ts` exports a handler taking `(request, env)` — the shape a Worker is
 * invoked with, and also the shape of a plain function from a request to a
 * response. So there is nothing here but the loop that calls it: the process
 * environment stands in for the bindings, and a port stands in for the route.
 *
 * This is the path a self-hoster takes, and the one this deployment takes when
 * it stops being a Worker. Keeping it in the tree rather than writing it on
 * that day is what stops the handler from quietly growing a dependency on a
 * platform it will not always be on — the difference shows up as a type error
 * here rather than as a discovery during a migration.
 */
import handler from './index.js';

const port = Number(process.env.PORT ?? 1337);

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
			process.env as unknown as Parameters<typeof handler.fetch>[1],
			{
				waitUntil: (promise: Promise<unknown>) => {
					void Promise.resolve(promise).catch((error: unknown) => {
						console.error('[auth] background task failed:', error);
					});
				},
				passThroughOnException: () => {}
			} as unknown as ExecutionContext
		)
});

console.log(`[auth] listening on http://0.0.0.0:${port}`);
