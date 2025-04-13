import { bus } from "./bus";
import { auth } from "./auth";
import { domain } from "./dns";
import { secret } from "./secret";
import { cluster } from "./cluster";
import { postgres } from "./postgres";

export const api = new sst.aws.Service("Api", {
    cpu: $app.stage === "production" ? "2 vCPU" : undefined,
    memory: $app.stage === "production" ? "4 GB" : undefined,
    cluster,
    command: ["bun", "run", "./src/api/index.ts"],
    link: [
        bus,
        auth,
        postgres,
        secret.PolarSecret,
    ],
    image: {
        dockerfile: "packages/functions/Containerfile",
    },
    environment: {
        NO_COLOR: "1",
    },
    loadBalancer: {
        domain: "api." + domain,
        rules: [
            {
                listen: "80/http",
                forward: "3001/http",
            },
            {
                listen: "443/https",
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