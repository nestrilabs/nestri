import { bus } from "./bus";
import { vpc } from "./vpc";
import { auth } from "./auth";
import { domain } from "./dns";
import { secret } from "./secret";
import { postgres } from "./postgres";

const urls = new sst.Linkable("Urls", {
    properties: {
        api: `https://api.${domain}`,
        auth: `https://auth.${domain}`,
        site: $dev ? "http://localhost:3000" : `https://console.${domain}`,
    }
})

const apiFn = new sst.aws.Function("ApiFn", {
    vpc,
    handler: "packages/functions/src/api/index.handler",
    streaming: !$dev,
    link: [
        bus,
        urls,
        auth,
        postgres,
        secret.SteamApiKey,
        secret.PolarSecret,
        secret.PolarWebhookSecret,
        secret.NestriFamilyMonthly,
        secret.NestriFamilyYearly,
        secret.NestriFreeMonthly,
        secret.NestriProMonthly,
        secret.NestriProYearly,
    ],
    url: true,
});

const provider = new aws.Provider("UsEast1", { region: "us-east-1" });

const webAcl = new aws.wafv2.WebAcl(
    "ApiWaf",
    {
        scope: "CLOUDFRONT",
        defaultAction: {
            allow: {},
        },
        visibilityConfig: {
            cloudwatchMetricsEnabled: true,
            metricName: "api-rate-limit-metric",
            sampledRequestsEnabled: true,
        },
        rules: [
            {
                name: "rate-limit-rule",
                priority: 1,
                action: {
                    block: {
                        customResponse: {
                            responseCode: 429,
                            customResponseBodyKey: "rate-limit-response",
                        },
                    },
                },
                statement: {
                    rateBasedStatement: {
                        limit: 2 * 60, // 2 rps per authorization header
                        evaluationWindowSec: 60,
                        aggregateKeyType: "CUSTOM_KEYS",
                        customKeys: [
                            {
                                header: {
                                    name: "Authorization",
                                    textTransformations: [{ priority: 0, type: "NONE" }],
                                },
                            },
                        ],
                    },
                },
                visibilityConfig: {
                    cloudwatchMetricsEnabled: true,
                    metricName: "rate-limit-rule-metric",
                    sampledRequestsEnabled: true,
                },
            },
        ],
        customResponseBodies: [
            {
                key: "rate-limit-response",
                content: JSON.stringify({
                    type: "rate_limit",
                    code: "too_many_requests",
                    message: "Rate limit exceeded. Please try again later.",
                }),
                contentType: "APPLICATION_JSON",
            },
        ],
    },
    { provider },
);

export const api = new sst.aws.Router("Api", {
    routes: {
        "/*": apiFn.url,
    },
    domain: {
        name: "api." + domain,
        dns: sst.cloudflare.dns(),
    },
    transform: {
        cdn(args) {
            if (!args.transform) {
                args.transform = {
                    distribution: {},
                };
            }
            args.transform!.distribution = {
                webAclId: webAcl.arn,
            };
        },
    },
});