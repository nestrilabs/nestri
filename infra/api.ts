import { authFingerprintKey } from "./auth";
import { domain } from "./dns";
import { secret } from "./secrets"
// import { party } from "./party"
import { gpuTaskDefinition, ecsCluster } from "./cluster";

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
        ecsCluster,
        gpuTaskDefinition,
        authFingerprintKey,
        secret.LoopsApiKey,
        secret.InstantAppId,
        secret.AwsAccessKey,
        secret.AwsSecretKey,
        secret.InstantAdminToken,
    ],
    url: true,
    handler: "./packages/functions/src/api/index.ts",
    domain: "api." + domain
})

export const outputs = {
    auth: auth.url,
    api: api.url
}