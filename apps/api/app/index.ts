import { Env } from '@nestri/core/env';
import { ErrorCodes, VisibleError } from '@nestri/core/error';
import type { InferEnv } from 'alchemy/Cloudflare';
import { Hono } from 'hono';
import { openAPISpecs } from 'hono-openapi';
import { cors } from 'hono/cors';
import { HTTPException } from 'hono/http-exception';
import { logger } from 'hono/logger';
import { type ContentfulStatusCode } from 'hono/utils/http-status';

import type { Api } from '../../../alchemy.run.ts';
import { auth } from './middleware/auth.js';
import { AccessTokenApi } from './routes/access-token.js';
import { GameApi } from './routes/game.js';
import { IndexApi } from './routes/index.js';
import { LibraryApi } from './routes/library.js';
import { MachineApi } from './routes/machine.js';
import { PairingCodeApi } from './routes/pairing-code.js';
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

export default {
	fetch(request: Request, env: InferEnv<typeof Api>, ctx: ExecutionContext) {
		Env.init(env as unknown as Record<string, unknown>);
		return app.fetch(request, env, ctx);
	}
};
