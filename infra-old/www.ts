// This is the website part where people play and connect
import { api } from "./api";
import { auth } from "./auth";
import { zero } from "./zero";
import { domain } from "./dns";

new sst.aws.StaticSite("Web", {
    path: "packages/www",
    build: {
        output: "./dist",
        command: "bun run build",
    },
    domain: {
        dns: sst.cloudflare.dns(),
        name: "console." + domain
    },
    environment: {
        VITE_API_URL: api.url,
        VITE_STAGE: $app.stage,
        VITE_AUTH_URL: auth.url,
        VITE_ZERO_URL: zero.url,
    },
})