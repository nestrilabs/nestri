import { domain } from "./dns";

new sst.cloudflare.x.Astro("Web", {
  domain,
  path: "packages/web",
  environment: {
    SST_STAGE: $app.stage,
  },
})
