import { getRelativeUrl } from '../util.js';
import { Provider } from './provider.js';

const STEAM_OPENID_URL = 'https://steamcommunity.com/openid/login';

export function SteamProvider(): Provider<{ steamid: string }> {
	return {
		type: 'steam',
		init(routes, ctx) {
			routes.get('/authorize', async (c) => {
				const returnUrl = getRelativeUrl(c, './callback');
				const openidURL =
					`${STEAM_OPENID_URL}?` +
					`openid.ns=${encodeURIComponent('http://specs.openid.net/auth/2.0')}&` +
					`openid.mode=checkid_setup&` +
					`openid.return_to=${encodeURIComponent(returnUrl)}&` +
					`openid.realm=${encodeURIComponent(new URL(c.req.url).origin)}&` +
					`openid.identity=${encodeURIComponent('http://specs.openid.net/auth/2.0/identifier_select')}&` +
					`openid.claimed_id=${encodeURIComponent('http://specs.openid.net/auth/2.0/identifier_select')}`;
				return c.redirect(openidURL);
			});

			routes.get('/callback', async (c) => {
				const url = new URL(c.req.url);
				const params = Object.fromEntries(url.searchParams.entries());

				const verifyRes = await fetch(STEAM_OPENID_URL, {
					method: 'POST',
					body: new URLSearchParams({
						...params,
						'openid.mode': 'check_authentication'
					}),
					headers: {
						'Content-Type': 'application/x-www-form-urlencoded'
					}
				});

				const verifyText = await verifyRes.text();
				if (!verifyText.includes('is_valid:true')) {
					throw new Error('Steam OpenID validation failed');
				}

				const steamid = params['openid.claimed_id']?.split('/').pop();
				if (!steamid) {
					throw new Error('Steam ID not found');
				}

				return ctx.success(c, { steamid });
			});
		}
	};
}
