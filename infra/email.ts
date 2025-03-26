import { domain } from "./dns";

export const email = new sst.aws.Email("Email",{
    sender: domain,
    dns: sst.cloudflare.dns(),
})