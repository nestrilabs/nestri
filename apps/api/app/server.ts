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

// Loopback by default, and that is a security setting rather than a
// convenience. Under a Cloudflare Tunnel nothing reaches this process except
// `cloudflared` on the same machine, and this address is half of what makes
// that true -- the machine's firewall is the other half.
//
// It was `0.0.0.0` until 2026-09-16, which was harmless while the only
// deployment was `docker-compose.yml`, because that publishes these ports on
// `127.0.0.1` and the container's own bind never mattered. As an ordinary
// process there is no such wrapper: `0.0.0.0` is a public listener.
//
// `HOST` exists for the deployment that genuinely wants one -- a container,
// where binding loopback would make the port unpublishable.
const hostname = process.env.HOST ?? '127.0.0.1';

Bun.serve({
	port,
	hostname,
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

console.log(`[api] listening on http://${hostname}:${port}`);
