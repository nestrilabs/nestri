import { domain } from "./dns";

export const email = new sst.aws.Email("Mail",{
    sender: domain,
    dns: sst.cloudflare.dns(),
})