import { domain } from "./dns";
import { secret } from "./secrets"
// import { party } from "./party"

sst.Linkable.wrap(random.RandomString, (resource) => ({
    properties: {
        value: resource.result,
    },
}));

export const authFingerprintKey = new random.RandomString(
    "AuthFingerprintKey",
    {
        length: 32,
    },
);

export const urls = new sst.Linkable("Urls", {
    properties: {
        api: "https://api." + domain,
        auth: "https://auth." + domain,
    },
});

export const kv = new sst.cloudflare.Kv("CloudflareAuthKV")

export const auth = new sst.cloudflare.Worker("Auth", {
    link: [
        kv,
        urls,
        authFingerprintKey,
        secret.InstantAdminToken,
        secret.InstantAppId,
        secret.LoopsApiKey,
        secret.GithubClientID,
        secret.GithubClientSecret,
        secret.DiscordClientID,
        secret.DiscordClientSecret,
    ],
    handler: "./packages/functions/src/auth.ts",
    url: true,
    domain: "auth." + domain
});

export const api = new sst.cloudflare.Worker("Api", {
    link: [
        urls,
        // party,
        authFingerprintKey,
        secret.InstantAdminToken,
        secret.InstantAppId,
        secret.LoopsApiKey,
    ],
    url: true,
    handler: "./packages/functions/src/api/index.ts",
    domain: "api." + domain
})

export const outputs = {
    auth: auth.url,
    api: api.url
}