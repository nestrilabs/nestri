import {
    type ExecutionContext,
    type KVNamespace,
} from "@cloudflare/workers-types"
import { subjects } from "./subjects"
import { Resource } from "sst/resource"
import { User } from "@nestri/core/user/index"
import { Email } from "@nestri/core/email/index"
// import { Team } from "@nestri/core/team/index"
import { authorizer } from "@openauthjs/openauth"
import { createClient } from "@openauthjs/openauth/client";
import { CodeUI } from "@openauthjs/openauth/ui/code";
import { PasswordUI } from "@openauthjs/openauth/ui/password"
import { CodeAdapter } from "@openauthjs/openauth/adapter/code";
// import type { Adapter } from "@openauthjs/openauth/adapter/adapter"
import { PasswordAdapter } from "@openauthjs/openauth/adapter/password"
import { CloudflareStorage } from "@openauthjs/openauth/storage/cloudflare"
import type { Adapter } from "@openauthjs/openauth/adapter/adapter"
// import { generateUnbiasedDigits, timingSafeCompare } from "@openauthjs/openauth/random"
// import { ApiAdapter } from "./adapter"
interface Env {
    CloudflareAuthKV: KVNamespace
}
interface CloudflareCF {
    colo: string;
    continent: string;
    country: string,
    city: string;
    region: string;
    longitude: number;
    latitude: number;
    metroCode: string;
    postalCode: string;
    timezone: string;
    regionCode: number;
}
interface CFRequest extends Request {
    cf: CloudflareCF
}

export type CodeAdapterState =
    | {
        type: "start"
    }
    | {
        type: "code"
        resend?: boolean
        code: string
        claims: Record<string, string>
    }

export default {
    async fetch(request: CFRequest, env: Env, ctx: ExecutionContext) {
        const location = `${request.cf.country},${request.cf.continent}`
        return authorizer({
            theme: {
                title: "Nestri | Auth",
                primary: "#FF4F01",
                //TODO: Change this in prod
                logo: "https://nestri.pages.dev/logo.webp",
                favicon: "https://nestri.pages.dev/seo/favicon.ico",
                background: {
                    light: "#f5f5f5 ",
                    dark: "#171717"
                },
                radius: "lg",
                font: {
                    family: "Geist, sans-serif",
                },
                css: `
                    @import url('https://fonts.googleapis.com/css2?family=Geist:wght@100;200;300;400;500;600;700;800;900&display=swap');
                  `,
            },
            storage: CloudflareStorage({
                namespace: env.CloudflareAuthKV,
            }),
            subjects,
            providers: {
                code: CodeAdapter<{ email: string }>(
                    CodeUI({
                        sendCode: async (claims, code) => {
                            console.log("emails & code:", claims.email, code);
                            await Email.send(claims.email, code)
                        },
                    }),
                ),
                password: PasswordAdapter(
                    PasswordUI({
                        sendCode: async (email, code) => {
                            console.log("email & code:", email, code)
                            await Email.send(email, code)
                        },
                    }),
                ),
                // device: {
                //     type: "device",
                // async client(input) {
                //     if (input.clientSecret !== Resource.AuthFingerprintKey.value) {
                //         throw new Error("Invalid authorization token");
                //     }

                //     const fingerprint = input.params.fingerprint;
                //     if (!fingerprint) {
                //         throw new Error("Fingerprint is required");
                //     }

                //     const hostname = input.params.hostname;
                //     if (!hostname) {
                //         throw new Error("Hostname of the machine is required");
                //     }

                //     return {
                //         fingerprint,
                //         hostname,
                //         email: undefined
                //     };
                // },
                // init(route, ctx) {
                //     route.post("/callback", async (c) => {
                //         const code = c.req.query("code")
                //         const authClient = () => createClient({
                //             clientID: "device",
                //             issuer: Resource.Urls.auth, // this is the url for your auth server
                //         })

                //         if (code) {
                //             const tokens = await authClient().exchange(code, Resource.Urls.auth + "/device/callback")
                //             console.log("tokens", tokens)
                //             c.newResponse("tokens are alright", 200)
                //         }
                //         c.newResponse("Something went wrong", 500)
                // const fd = await c.req.formData()
                // const clientSecret = fd.get("clientSecret")?.toString()
                // if (clientSecret !== Resource.AuthFingerprintKey.value) {
                //     return c.newResponse("Invalid authorization token", 401);
                // }
                // const action = fd.get("action")?.toString()
                // if (!action) {
                //     return c.newResponse("Invalid action type", 400);
                // }

                // const digits = fd.get("code")?.toString()

                // if (action === "request" || typeof action === undefined) {
                //     const digits = generateUnbiasedDigits(6)

                //     await ctx.storage.set(["device"], { code: digits, verified: false }, new Date(new Date().getTime() + 60 * 60 * 24 * 1000))

                //     return c.newResponse(digits, 200)
                // } else if (action === "verify") {
                //     const compare = await ctx.storage.get(["device"])
                //     if (
                //         !digits ||
                //         !compare?.digits ||
                //         !timingSafeCompare(digits, compare?.digits)
                //     ) {
                //         return c.newResponse("Code error", 501)
                //     }

                //     await ctx.storage.set(["device"], { code: digits, verified: true }, new Date(new Date().getTime() + 60 * 60 * 1000))
                //     return c.newResponse("You can return to the CLI now", 200)
                // }
                // })

                // For polling
                // route.post("/token", async (c) => {
                //     const fd = await c.req.formData()
                //     const clientSecret = fd.get("clientSecret")?.toString()
                //     if (clientSecret !== Resource.AuthFingerprintKey.value) {
                //         return c.newResponse("Invalid authorization token", 401);
                //     }

                // })

                // Entering the machine code and verifying the machine
                // route.get("/authorize", async (c) => {

                // })
                // },
                // } as Adapter<{
                //     fingerprint: string;
                //     hostname: string;
                //     email: undefined
                // }>,
            },
            allow: async (input) => {
                // const url = new URL(input.redirectURI);
                // const hostname = url.hostname;
                // if (hostname.endsWith("nestri.io")) return true;
                // if (hostname === "localhost") return true;
                // if (input.clientID === "machine") return true;
                return true;
            },
            success: async (ctx, value) => {
                let email = undefined as string | undefined;

                // if (value.provider === "device") {
                //     // Register the machine if it is not already registered
                //     const matchingUser = await User.fromEmail(email);
                //     const matchingMachines = await Machine.fromFingerprint(value.fingerprint)
                //     if (matchingMachines.length === 0) {
                //         await Machine.create({ fingerprint: value.fingerprint, owner: matchingUser.id, name: value.name, location })
                //     }
                // }

                email = value.provider === "code" ? value.claims.email : value.email;

                if (email) {
                    const token = await User.create(email);
                    const user = await User.fromEmail(email);

                    return ctx.subject("user", {
                        accessToken: token,
                        userID: user.id
                    });
                }

                throw new Error("This is not implemented yet");
            },
        }).fetch(request, env, ctx)
    }
}