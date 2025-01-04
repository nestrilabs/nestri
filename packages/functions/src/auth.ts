import { Resource } from "sst"
import {
    type ExecutionContext,
    type KVNamespace,
} from "@cloudflare/workers-types"
import { subjects } from "./subjects"
import { User } from "@nestri/core/user/index"
import { Email } from "@nestri/core/email/index"
import { authorizer } from "@openauthjs/openauth"
import { type CFRequest } from "@nestri/core/types"
import { Select } from "@openauthjs/openauth/ui/select";
import { PasswordUI } from "@openauthjs/openauth/ui/password"
import type { Adapter } from "@openauthjs/openauth/adapter/adapter"
import { PasswordAdapter } from "@openauthjs/openauth/adapter/password"
import { CloudflareStorage } from "@openauthjs/openauth/storage/cloudflare"
import { Machine } from "@nestri/core/machine/index"

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
                password: PasswordAdapter(
                    PasswordUI({
                        sendCode: async (email, code) => {
                            console.log("email & code:", email, code)
                            await Email.send(email, code)
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
                return true;
            },
            success: async (ctx, value) => {
                if (value.provider === "device") {
                    let exists = await Machine.fromFingerprint(value.fingerprint);
                    if (!exists) {
                        const machineID = await Machine.create({
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

                const email = value.email;

                if (email) {
                    const token = await User.create(email);
                    const user = await User.fromEmail(email);

                    return await ctx.subject("user", {
                        accessToken: token,
                        userID: user.id
                    });
                }

                throw new Error("This is not implemented yet");
            },
        }).fetch(request, env, ctx)
    }
}