// This is the website part where people play and connect
import { urls } from "./api";
import { domain } from "./dns";

new sst.aws.Astro("Web", {
    path: "./packages/www",
    link:[
        urls
    ],
    domain:{
        dns: sst.cloudflare.dns(),
        name: "console."+ domain
    }
  })