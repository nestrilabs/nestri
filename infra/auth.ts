import { bus } from "./bus";
import { vpc } from "./vpc";
import { domain } from "./dns";
import { secret } from "./secret";
import { postgres } from "./postgres";

export const auth = new sst.aws.Auth("Auth", {
    authorizer: {
        vpc,
        link: [
            bus,
            postgres,
            secret.PolarSecret,
            secret.GithubClientID,
            secret.DiscordClientID,
            secret.GithubClientSecret,
            secret.DiscordClientSecret,
        ],
        permissions: [
            {
                actions: ["ses:SendEmail"],
                resources: ["*"],
            },
        ],
        handler: "packages/functions/src/auth/index.handler",
    },
    domain: {
        name: "auth." + domain,
        dns: sst.cloudflare.dns(),
    },
    forceUpgrade: "v2",
});