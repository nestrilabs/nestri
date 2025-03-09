import { bus } from "./bus";
import { domain } from "./dns";
import { email } from "./email";
import { secret } from "./secret";
import { database } from "./database";


export const authFingerprintKey = new random.RandomString(
    "AuthFingerprintKey",
    {
        length: 32,
    },
);

export const auth = new sst.aws.Auth("Auth", {
    issuer: {
        timeout: "3 minutes",
        handler: "./packages/functions/src/auth.handler",
        link: [
            bus,
            email,
            database,
            authFingerprintKey,
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
    },
    domain: {
        name: "auth." + domain,
        dns: sst.cloudflare.dns(),
    },
})

export const outputs = {
    auth: auth.url,
};