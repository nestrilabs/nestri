import { bus } from "./bus";
import { domain } from "./dns";
import { email } from "./email";
import { secret } from "./secret";
import { database } from "./database";

sst.Linkable.wrap(random.RandomString, (resource) => ({
    properties: {
        value: resource.result,
    },
}));

export const urls = new sst.Linkable("Urls", {
    properties: {
        api: "https://api." + domain,
        auth: "https://auth." + domain,
        site: $dev ? "http://localhost:4321" : "https://" + domain,
    },
});

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

export const apiFunction = new sst.aws.Function("ApiFn", {
    handler: "packages/functions/src/api/index.handler",
    permissions: [
        {
            actions: ["iot:*"],
            resources: ["*"],
        },
    ],
    link: [
        bus,
        urls,
        database,
        secret.PolarSecret,
    ],
    timeout: "3 minutes",
    streaming: !$dev,
    url: true
})

export const api = new sst.aws.Router("Api", {
    routes: {
        "/*": apiFunction.url
    },
    domain: {
        name: "api." + domain,
        dns: sst.cloudflare.dns(),
    },
})

export const outputs = {
    auth: auth.url,
    api: api.url,
};