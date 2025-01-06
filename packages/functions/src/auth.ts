import { Resource } from "sst"
import {
    type ExecutionContext,
    type KVNamespace,
} from "@cloudflare/workers-types"
import { subjects } from "./subjects"
import { authorizer } from "@openauthjs/openauth"
import { type CFRequest } from "@nestri/core/types"
import { Select } from "./ui/select";
// import { PasswordUI } from "@openauthjs/openauth/ui/password"
import { PasswordUI } from "./ui/password"
import type { Adapter } from "@openauthjs/openauth/adapter/adapter"
import { GithubAdapter } from "@openauthjs/openauth/adapter/github";
import { DiscordAdapter } from "@openauthjs/openauth/adapter/discord";
import { PasswordAdapter } from "./ui/adapters/password"
import { CloudflareStorage } from "@openauthjs/openauth/storage/cloudflare"
import { Machines } from "@nestri/core/machine/index"

interface Env {
    CloudflareAuthKV: KVNamespace
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
        // const location = `${request.cf.country},${request.cf.continent}`
        return authorizer({
            select: Select({
                providers: {
                    device: {
                        hide: true,
                    },
                },
            }),
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
                github: GithubAdapter({
                    clientID: Resource.GithubClientID.value,
                    clientSecret: Resource.GithubClientSecret.value,
                    scopes: ["user:email"]
                }),
                discord: DiscordAdapter({
                    clientID: Resource.DiscordClientID.value,
                    clientSecret: Resource.DiscordClientSecret.value,
                    scopes: ["email","identify"]
                }),
                password: PasswordAdapter(
                    PasswordUI({
                        sendCode: async (email, code) => {
                            console.log("email & code:", email, code)
                            // await Email.send(email, code)
                        },
                    }),
                ),
                device: {
                    type: "device",
                    async client(input) {
                        if (input.clientSecret !== Resource.AuthFingerprintKey.value) {
                            throw new Error("Invalid authorization token");
                        }

                        const fingerprint = input.params.fingerprint;
                        if (!fingerprint) {
                            throw new Error("Fingerprint is required");
                        }

                        const hostname = input.params.hostname;
                        if (!hostname) {
                            throw new Error("Hostname is required");
                        }
                        return {
                            fingerprint,
                            hostname
                        };
                    },
                    init() { }
                } as Adapter<{ fingerprint: string; hostname: string }>,
            },
            allow: async (input) => {
                const url = new URL(input.redirectURI);
                const hostname = url.hostname;
                if (hostname.endsWith("nestri.io")) return true;
                if (hostname === "localhost") return true;
                return false;
            },
            success: async (ctx, value) => {
                if (value.provider === "device") {
                    let exists = await Machines.fromFingerprint(value.fingerprint);
                    if (!exists) {
                        const machineID = await Machines.create({
                            fingerprint: value.fingerprint,
                            hostname: value.hostname,
                        });

                        return await ctx.subject("device", {
                            id: machineID,
                            fingerprint: value.fingerprint
                        })
                    }

                    return await ctx.subject("device", {
                        id: exists.id,
                        fingerprint: value.fingerprint
                    })

                }

                let email = undefined as string | undefined;

                if (value.provider === "github") {
                    const access = value.tokenset.access;
                    const response = await fetch("https://api.github.com/user/emails", {
                        headers: {
                            Authorization: `token ${access}`,
                            Accept: "application/vnd.github.v3+json",
                        },
                    });
                    const emails = (await response.json()) as any[];
                    const primary = emails.find((email: any) => email.primary);
                    console.log(primary);
                    if (!primary.verified) {
                        throw new Error("Email not verified");
                    }
                    email = primary.email;
                }

                if(email){
                    console.log("email", email)
                    // value.username && console.log("username", value.username)

                }

                // if (email) {
                //     const token = await User.create(email);
                //     const user = await User.fromEmail(email);

                //     return await ctx.subject("user", {
                //         accessToken: token,
                //         userID: user.id
                //     });
                // }

                throw new Error("This is not implemented yet");
            },
        }).fetch(request, env, ctx)
    }
}