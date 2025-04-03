import { bus } from "./bus";
import { domain } from "./dns";
// import { email } from "./email";
import { secret } from "./secret";
import { postgres } from "./postgres";
import { cluster } from "./cluster";

// sst.Linkable.wrap(random.RandomString, (resource) => ({
//     properties: {
//         value: resource.result,
//     },
// }));

// export const authFingerprintKey = new random.RandomString(
//     "AuthFingerprintKey",
//     {
//         length: 32,
//     },
// );

export const auth = new sst.aws.Service("Auth", {
    cpu: $app.stage === "production" ? "1 vCPU" : undefined,
    memory: $app.stage === "production" ? "2 GB" : undefined,
    cluster,
    command: ["bun", "run", "./src/auth.ts"],
    link: [
        bus,
        postgres,
        secret.PolarSecret,
        secret.GithubClientID,
        secret.DiscordClientID,
        secret.GithubClientSecret,
        secret.DiscordClientSecret,
    ],
    image: {
        dockerfile: "packages/functions/Containerfile",
    },
    environment: {
        NO_COLOR: "1",
    },
    loadBalancer: {
        domain: "auth." + domain,
        rules: [
            {
                listen: "80/http",
                forward: "3002/http",
            },
            {
                listen: "443/https",
                forward: "3002/http",
            },
        ],
    },
    // permissions: [
    //     {
    //         resources: ["*"],
    //         actions: [
    //             "ses:SendEmail"
    //             "s3:*",
    //             "ssm:*",
    //              "lambda:*",
    //             "cloudwatch:*",
    //             "iam:PassRole",
    //         ],
    //     },
    // ],
    dev: {
        command: "bun dev:auth",
        directory: "packages/functions",
        url: "http://localhost:3002",
    },
    scaling:
        $app.stage === "production"
            ? {
                min: 2,
                max: 10,
            }
            : undefined,
});

// export const auth = new sst.aws.Auth("Auth", {
//     issuer: {
//         vpc,
//         timeout: "3 minutes",
//         handler: "packages/functions/src/auth.handler",
//         link: [
//             bus,
//             // email,
//             postgres,
//             // authFingerprintKey,
//             secret.PolarSecret,
//             secret.GithubClientID,
//             secret.DiscordClientID,
//             secret.GithubClientSecret,
//             secret.DiscordClientSecret,
//         ],
//         permissions: [
//             {
//                 actions: ["ses:SendEmail"],
//                 resources: ["*"],
//             },
//         ],
//     },
//     domain: {
//         name: "auth." + domain,
//         dns: sst.cloudflare.dns(),
//     },
// })

// export const outputs = {
//     auth: auth.url,
// };