import { bus } from "./bus";
import { auth } from "./auth";
import { domain } from "./dns";
import { secret } from "./secret";
import { cluster } from "./cluster";
import { postgres } from "./postgres";

export const api = new sst.aws.Service("Api", {
    cluster,
    cpu: $app.stage === "production" ? "2 vCPU" : undefined,
    memory: $app.stage === "production" ? "4 GB" : undefined,
    command: ["bun", "run", "./src/api/index.ts"],
    link: [
        bus,
        auth,
        postgres,
        secret.PolarSecret,
        secret.PolarWebhookSecret,
        secret.NestriFamilyMonthly,
        secret.NestriFamilyYearly,
        secret.NestriProMonthly,
        secret.NestriProYearly,
        secret.NestriFreeMonthly,
    ],
    image: {
        dockerfile: "packages/functions/Containerfile",
    },
    environment: {
        NO_COLOR: "1",
    },
    loadBalancer: {
        rules: [
            {
                listen: "80/http",
                forward: "3001/http",
            },
        ],
    },
    dev: {
        command: "bun dev:api",
        directory: "packages/functions",
        url: "http://localhost:3001",
    },
    scaling:
        $app.stage === "production"
            ? {
                min: 2,
                max: 10,
            }
            : undefined,
});


export const apiRoute = new sst.aws.Router("ApiRoute", {
    routes: {
        // I think api.url should work all the same
        "/*": api.nodes.loadBalancer.dnsName,
    },
    domain: {
        name: "api." + domain,
        dns: sst.cloudflare.dns(),
    },
})