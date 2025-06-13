import { domain } from "./dns";
import { storage } from "./storage";

export const cdn = new sst.aws.Router("CDNRouter", {
    routes: {
        "/*": {
            bucket: storage,
            rewrite: {
                regex: "^/([a-zA-Z0-9_-]+)$",
                to: "/public/$1"
            },
        },
    },
    domain: {
        name: "cdn." + domain,
        dns: sst.cloudflare.dns()
    }
});

export const outputs = {
    cdn: cdn.url
}