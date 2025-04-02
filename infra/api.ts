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
    link: [
        bus,
        auth,
        postgres,
        secret.PolarSecret,
    ],
    image: {
        dockerfile: "packages/functions/Dockerfile",
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
    // permissions: [
    //     {
    //         resources: ["*"],
    //         actions: [
    //             "sts:*",
    //             "logs:*",
    //             "ses:*",
    //             "iot:*",
    //             "s3:*",
    //             "ssm:*",
    //             "cloudwatch:*",
    //             "iam:PassRole",
    //         ],
    //     },
    // ],
    dev: {
        command: "bun dev",
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

// export const outputs = {
//     api: api.url,
// };