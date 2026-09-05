import type { Hyperdrive } from '@cloudflare/workers-types';
import { Env } from '@nestri/core/env';
import { ErrorCodes, VisibleError } from '@nestri/core/error';
import { Hono } from 'hono';
import { openAPISpecs } from 'hono-openapi';
import { cors } from 'hono/cors';
import { HTTPException } from 'hono/http-exception';
import { logger } from 'hono/logger';
import { type ContentfulStatusCode } from 'hono/utils/http-status';

import { auth } from './middleware/auth.js';
import { AccessTokenApi } from './routes/access-token.js';
import { GameApi } from './routes/game.js';
import { IndexApi } from './routes/index.js';
import { LibraryApi } from './routes/library.js';
import { MachineApi } from './routes/machine.js';
import { PairingCodeApi } from './routes/pairing-code.js';
import { SessionApi } from './routes/session.js';
import { SteamApi } from './routes/steam.js';
import { UserApi } from './routes/user.js';
import { WaitlistApi } from './routes/waitlist.js';

export const app = new Hono();

app
	.use(logger())
	.use(async (c, next) => {
		c.header('Cache-Control', 'no-store');
		return next();
	})
	.use(
		cors({
			origin: () => 'http://localhost:5173',
			credentials: true
		})
	)
	.use(auth);

const routes = app
	.route('/', IndexApi.route)
	.route('/user', UserApi.route)
	.route('/steam', SteamApi.route)
	.route('/library', LibraryApi.route)
	.route('/games', GameApi.route)
	.route('/pairing-code', PairingCodeApi.route)
	.route('/machine', MachineApi.route)
	.route('/machine', SessionApi.machineRoute)
	.route('/session', SessionApi.route)
	.route('/access-token', AccessTokenApi.route)
	.route('/waitlist', WaitlistApi.route)
	.onError((error, c) => {
		if (error instanceof VisibleError) {
			// eslint-disable-next-line no-console
			console.error('api error:', error);
			return c.json(error.toResponse(), error.statusCode() as ContentfulStatusCode);
		}

		if (error instanceof HTTPException) {
			// eslint-disable-next-line no-console
			console.error('http error:', error);
			return c.json(
				{
					type: 'validation',
					code: ErrorCodes.Validation.INVALID_PARAMETER,
					message: 'Invalid request'
				},
				error.status
			);
		}
		// eslint-disable-next-line no-console
		console.error('unhandled error:', error);
		return c.json(
			{
				type: 'internal',
				code: ErrorCodes.Server.INTERNAL_ERROR,
				message: 'Internal server error'
			},
			500
		);
	});

app.get(
	'/doc',
	openAPISpecs(routes, {
		documentation: {
			info: {
				title: 'Nestri API',
				description: 'API',
				version: '0.0.1'
			},
			components: {
				securitySchemes: {
					Bearer: {
						type: 'http',
						scheme: 'bearer',
						bearerFormat: 'JWT'
					}
				}
			},
			security: [{ Bearer: [] }]
		}
	})
);

/**
 * Everything this app is handed, from a binding or from the environment.
 *
 * Two things here arrive one of two ways, and neither is a special case.
 * `HYPERDRIVE` carries a connection string on a platform that pools
 * connections for us, and `DATABASE_URL` says the same thing where nothing
 * does. An `AUTH` binding is a route to the issuer that skips the internet,
 * and `AUTH_INTERNAL_URL` is that route written out. Each pair is two
 * spellings of one fact rather than two deployments, which is why nothing
 * below branches on the runtime it is under.
 *
 * `AUTH_ISSUER_URL` is not part of either pair. It is the issuer's public
 * *name*, it is required, and it is the same value however the issuer is
 * reached — because it is what every token's `iss` claim is checked against.
 */
export type ApiEnv = {
	AUTH?: { fetch: typeof fetch };
	AUTH_ISSUER_URL?: string;
	AUTH_INTERNAL_URL?: string;
	HYPERDRIVE?: Hyperdrive;
	DATABASE_URL?: string;
	ADMIN_SHARED_SECRET?: string;
};

export default {
	fetch(request: Request, env: ApiEnv, ctx?: ExecutionContext) {
		Env.init(env as unknown as Record<string, unknown>);
		return app.fetch(request, env, ctx);
	}
};
