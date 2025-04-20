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
    link: [
        bus,
        auth,
        postgres,
        secret.PolarSecret,
        secret.PolarWebhookSecret,
        secret.NestriFamilyMonthly,
        secret.NestriFamilyYearly,
        secret.NestriFreeMonthly,
        secret.NestriProMonthly,
        secret.NestriProYearly,
    ],
    containers: [
        {
            name: "api-container",
            image: {
                dockerfile: "packages/functions/Containerfile",
            },
            command: ["bun", "run", "./src/api/index.ts"],
            dev: {
                command: "bun dev:api",
                directory: "packages/functions",
            }
        },
        {
            name: "steam-container",
            image: {
                dockerfile: "packages/steam/Containerfile"
            },
            command: ["dotnet", "run"],
            dev: {
                command: "bun dev",
                directory: "packages/steam",
            }
        }
    ],
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
        url: "http://localhost:3001",
    },
    scaling:
        $app.stage === "production"
            ? {
                min: 2,
                max: 10,
            }
            : undefined,
    transform: {
        taskDefinition: (args) => {
            const volumes = $output(args.volumes).apply(v => {
                v.push({
                    name: "shared-steam-unix",
                    dockerVolumeConfiguration: {
                        scope: "shared",
                        driver: "local"
                    }
                });
                return v;
            })

            // "containerDefinitions" is a JSON string, parse first
            let value = $jsonParse(args.containerDefinitions);

            value = value.apply((containerDefinitions) => {
                const api = containerDefinitions.find(c => c.name === "api-container");
                const steam = containerDefinitions.find(c => c.name === "steam-container");
                
                if (!api || !steam) throw new Error("Expected containers not found");

                api.mountPoints = [
                    { sourceVolume: "shared-steam-unix", containerPath: "/tmp" }
                ];

                steam.volumesFrom = [
                    { sourceContainer: "api-container", readOnly: false }
                ];
                
                // containerDefinitions[0].mountPoints = [
                //     {
                //         sourceVolume: "shared-steam-unix",
                //         containerPath: "/tmp"
                //     }
                // ]
                // containerDefinitions[1].volumesFrom = [
                //     {
                //         sourceContainer: "api-container",
                //         readOnly: false
                //     }
                // ]
                return containerDefinitions;
            });

            args.containerDefinitions = $jsonStringify(value);
            args.volumes = volumes
        }
    }
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