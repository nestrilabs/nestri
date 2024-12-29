import { domain } from "./dns";
import { secret } from "./secrets"

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

export const kv = new sst.cloudflare.Kv("CloudflareAuthKV")

export const auth = new sst.cloudflare.Worker("Auth", {
    link: [
        kv,
        authFingerprintKey,
        secret.InstantAdminToken,
        secret.InstantAppId,
        secret.LoopsApiKey
    ],
    handler: "./packages/functions/auth.ts",
    url: true,
    domain: "auth." + domain
});

export const outputs = {
    auth: auth.url
}