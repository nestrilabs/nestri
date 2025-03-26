import { vpc } from "./vpc";
import { bus } from "./bus";
import { domain } from "./dns";
import { secret } from "./secret";
import { postgres } from "./postgres";

sst.Linkable.wrap(random.RandomString, (resource) => ({
    properties: {
        value: resource.result,
    },
}));

export const urls = new sst.Linkable("Urls", {
    properties: {
        api: "https://api." + domain,
        auth: "https://auth." + domain,
        site: $dev ? "http://localhost:3000" : "https://" + domain,
    },
});

export const apiFunction = new sst.aws.Function("ApiFn", {
    vpc,
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
        postgres,
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
    api: api.url,
};