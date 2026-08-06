import type { Context } from 'hono';

import type { Provider } from './provider.js';

export interface SshProviderConfig {
	sshAuthKey: string;
}

export interface SshLoginBody {
	fingerprint: string;
	steamId: string;
	username?: string;
	profile?: Record<string, unknown>;
}

export function SshProvider(config: SshProviderConfig): Provider<{
	fingerprint: string;
	steamId: string;
	username?: string;
	profile?: Record<string, unknown>;
}> {
	return {
		type: 'ssh',
		init(routes, ctx) {
			routes.post('/login', async (c: Context) => {
				const authHeader = c.req.header('Authorization');
				if (!authHeader) {
					return c.json({ error: 'Missing Authorization header' }, 401);
				}

				const bearer = authHeader.split(' ')[1];
				if (bearer !== config.sshAuthKey) {
					return c.json({ error: 'Invalid authorization token' }, 401);
				}

				const body = (await c.req.json()) as SshLoginBody;
				if (!body.fingerprint) {
					return c.json({ error: 'Fingerprint is required' }, 400);
				}
				if (!body.steamId || !/^\d{17}$/.test(body.steamId)) {
					return c.json({ error: 'steamId is required and must be a 17-digit Steam ID' }, 400);
				}

				return ctx.success(c, {
					fingerprint: body.fingerprint,
					steamId: body.steamId,
					username: body.username,
					profile: body.profile
				});
			});
		}
	};
}
