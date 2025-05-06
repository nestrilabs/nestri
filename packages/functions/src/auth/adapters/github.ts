import { Oauth2Adapter, type Oauth2WrappedConfig } from "../ui/oauth2"

export function GithubAdapter(config: Oauth2WrappedConfig) {
  return Oauth2Adapter({
    ...config,
    type: "github",
    endpoint: {
      authorization: "https://github.com/login/oauth/authorize",
      token: "https://github.com/login/oauth/access_token",
    },
  })
}
