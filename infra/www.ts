// This is the website part where people play and connect
import { domain } from "./dns";

new sst.aws.Astro("www", {
    path: "./packages/www",
    domain:{
        dns: sst.cloudflare.dns(),
        name: "console."+ domain
    }
  })