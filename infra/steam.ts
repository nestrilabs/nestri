import { domain } from "./dns";
import { cluster } from "./cluster";
import { auth } from "./auth";

export const steam = new sst.aws.Service("Steam", {
    cluster,
    wait: true,
    image: {
        context: "packages/steam",
    },
    loadBalancer: {
        domain:
            $app.stage === "production"
                ? undefined
                : {
                    name: "steam." + domain,
                    dns: sst.cloudflare.dns(),
                },
        rules: [
            { listen: "443/https", forward: "5289/http" },
            { listen: "80/http", forward: "5289/http" },
        ],
    },
    environment: {
        NESTRI_AUTH_JWKS_URL: $interpolate`${auth.url}`
    },
    scaling:
        $app.stage === "production"
            ? {
                min: 2,
                max: 4,
            }
            : undefined,
    logging: {
        retention: "1 month",
    },
    architecture: "arm64",
    dev: {
        directory: "packages/steam",
        command: "dotnet run",
        url: "http://localhost:5289",
    },
})