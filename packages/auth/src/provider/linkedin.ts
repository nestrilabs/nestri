import { Oauth2Provider, type Oauth2WrappedConfig } from './oauth2.js';

export function LinkedInAdapter(config: Oauth2WrappedConfig) {
	return Oauth2Provider({
		...config,
		type: 'linkedin',
		endpoint: {
			authorization: 'https://www.linkedin.com/oauth/v2/authorization',
			token: 'https://www.linkedin.com/oauth/v2/accessToken'
		}
	});
}
