import { bus } from "./bus";
import { domain } from "./dns";
import { secret } from "./secret";
import { cluster } from "./cluster";
import { postgres } from "./postgres";

//FIXME: Use a shared /tmp folder 
export const authService = new sst.aws.Service("Auth", {
    cluster,
    cpu: $app.stage === "production" ? "1 vCPU" : undefined,
    memory: $app.stage === "production" ? "2 GB" : undefined,
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
        STORAGE: $dev ? "/tmp/persist.json" : "/mnt/efs/persist.json"
    },
    loadBalancer: {
        rules: [
            {
                listen: "80/http",
                forward: "3002/http",
            },
        ],
    },
    permissions: [
        {
            actions: ["ses:SendEmail"],
            resources: ["*"],
        },
    ],
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
    //TODO: Add a shared volume here as well
});

export const auth = !$dev ? new sst.aws.Router("AuthRoute", {
    routes: {
        // I think auth.url should work all the same
        "/*": authService.nodes.loadBalancer.dnsName,
    },
    domain: {
        name: "auth." + domain,
        dns: sst.cloudflare.dns(),
    },
}) : authService