import {
    type ExecutionContext,
    type KVNamespace,
} from "@cloudflare/workers-types"
import { subjects } from "./subjects.js"
import { Resource } from "sst"
import { User } from "@nestri/core/user/index"
import { Email } from "@nestri/core/email/index"
import { authorizer } from "@openauthjs/openauth"
import { CodeUI } from "@openauthjs/openauth/ui/code";
import { Select } from "@openauthjs/openauth/ui/select";
import { PasswordUI } from "@openauthjs/openauth/ui/password"
import { CodeAdapter } from "@openauthjs/openauth/adapter/code";
import type { Adapter } from "@openauthjs/openauth/adapter/adapter"
import { PasswordAdapter } from "@openauthjs/openauth/adapter/password"
import { CloudflareStorage } from "@openauthjs/openauth/storage/cloudflare"


interface Env {
    CloudflareAuthKV: KVNamespace
}

async function getUser(email: string) {
    // Get user from database
    // Return user ID
    return "123"
}

export default {
    async fetch(request: Request, env: Env, ctx: ExecutionContext) {
        return authorizer({
            select: Select({
                providers: {
                    ssh: {
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
                code: CodeAdapter<{ email: string }>(
                    CodeUI({
                        sendCode: async (claims, code) => {
                            console.log(code, claims.email);
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
                ssh: {
                    type: "ssh",
                    async client(input) {
                        if (input.clientSecret !== Resource.AuthFingerprintKey.value) {
                            throw new Error("Invalid authorization token");
                        }

                        const fingerprint = input.params.fingerprint;
                        if (!fingerprint) {
                            throw new Error("Fingerprint is required");
                        }

                        const email = input.params.email;
                        if (!email) {
                            throw new Error("Email is required");
                        }

                        const name = input.params.name;
                        if (!email) {
                            throw new Error("Name is required");
                        }

                        const plan = input.params.plan;
                        if (!email) {
                            throw new Error("Subscription plan is required");
                        }
                        return {
                            fingerprint,
                            email,
                            name,
                            plan
                        };
                    },
                    init() { },
                } as Adapter<{
                    email: string;
                    fingerprint: string;
                }>,
            },
            allow: async (input) => {
                const url = new URL(input.redirectURI);
                const hostname = url.hostname;
                if (hostname.endsWith("nestri.io")) return true;
                if (hostname === "localhost") return true;
                return false;
            },
            success: async (ctx, value) => {
                let email = undefined as string | undefined;
                if (value.provider === "code") {
                    email = value.claims.email;
                } else {
                    email = value.email
                }
                
                if (email) {
                    const matchingUsers = await User.fromEmail(email);
                    if (matchingUsers.length === 0) {
                        const token = await User.createToken({
                            email,
                        });

                        console.log("token", token)

                        return ctx.subject("user", {
                            accessToken: token,
                        });
                    }

                }
                throw new Error("Invalid provider")
            },
        }).fetch(request, env, ctx)
    },
}