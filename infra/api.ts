import { bus } from "./bus";
import { auth } from "./auth";
import { domain } from "./dns";
import { secret } from "./secret";
import { cluster } from "./cluster";
import { postgres } from "./postgres";

export const apiService = new sst.aws.Service("Api", {
    cluster,
    cpu: $app.stage === "production" ? "2 vCPU" : undefined,
    memory: $app.stage === "production" ? "4 GB" : undefined,
    link: [
        bus,
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
    command: ["bun", "run", "./src/api/index.ts"],
    image: {
        dockerfile: "packages/functions/Containerfile",
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
        url: "http://localhost:3001",
        command: "bun dev:api",
        directory: "packages/functions",
    },
    scaling:
        $app.stage === "production"
            ? {
                min: 2,
                max: 10,
            }
            : undefined,
    // For persisting actor state
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
                    },
                ]
                return containerDefinitions;
            });

            args.volumes = volumes
            args.containerDefinitions = $jsonStringify(containers);
        }
    }
});


export const api = !$dev ? new sst.aws.Router("ApiRoute", {
    routes: {
        // I think api.url should work all the same
        "/*": apiService.nodes.loadBalancer.dnsName,
    },
    domain: {
        name: "api." + domain,
        dns: sst.cloudflare.dns(),
    },
}) : apiService