import { Oauth2Adapter, type Oauth2WrappedConfig } from "../ui/oauth2"

export function DiscordAdapter(config: Oauth2WrappedConfig) {
  return Oauth2Adapter({
    type: "discord",
    ...config,
    endpoint: {
      authorization: "https://discord.com/oauth2/authorize",
      token: "https://discord.com/api/oauth2/token",
    },
  })
}
