import { bus } from "./bus";
import { domain } from "./dns";
import { secret } from "./secret";
import { cluster } from "./cluster";
import { postgres } from "./postgres";

export const authService = new sst.aws.Service("Auth", {
    cluster,
    cpu: $app.stage === "production" ? "1 vCPU" : undefined,
    memory: $app.stage === "production" ? "2 GB" : undefined,
    command: ["bun", "run", "./src/auth/index.ts"],
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
        STORAGE: "/tmp/persist.json"
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
    //For temporarily persisting the persist.json
    transform: {
        taskDefinition: (args) => {
            const volumes = $output(args.volumes).apply(v => {
                const next = [...v, {
                    name: "shared-tmp",
                    dockerVolumeConfiguration: {
                        scope: "shared",
                        driver: "local"
                    }
                }];

                return next;
            })

            // "containerDefinitions" is a JSON string, parse first
            let containers = $jsonParse(args.containerDefinitions);

            containers = containers.apply((containerDefinitions) => {
                containerDefinitions[0].mountPoints = [
                    ...(containerDefinitions[0].mountPoints ?? []),
                    {
                        sourceVolume: "shared-tmp",
                        containerPath: "/tmp"
                    }
                ]
                return containerDefinitions;
            });

            args.volumes = volumes
            args.containerDefinitions = $jsonStringify(containers);
        }
    }
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