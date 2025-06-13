import { domain } from "./dns";
import { storage } from "./storage";

export const cdn = new sst.aws.Router("CDNRouter", {
    routes: {
        "/public": {
            bucket: storage,
            rewrite: {
                regex: "^/public/([a-zA-Z0-9_-]+)$",
                to: "/images/$1"
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