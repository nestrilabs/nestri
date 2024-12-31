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
import { createClient } from "@openauthjs/openauth/client"
import { PasswordUI } from "@openauthjs/openauth/ui/password"
import type { Adapter } from "@openauthjs/openauth/adapter/adapter"
import { PasswordAdapter } from "@openauthjs/openauth/adapter/password"
import { CloudflareStorage } from "@openauthjs/openauth/storage/cloudflare"

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
                    init(routes, ctx) {
                        routes.post("/callback", async (c) => {
                            const data = await c.req.formData();
                            const secret = data?.get("client_secret")
                            if (!secret || secret.toString() !== Resource.AuthFingerprintKey.value) {
                                return c.newResponse("Invalid authorization token", 401)
                            }

                            const redirectUrl = data?.get("redirect_url")
                            if (!redirectUrl) {
                                return c.newResponse("Invalid redirect url", 400)
                            }

                            const client = createClient({
                                clientID: "device",
                                issuer: Resource.Urls.auth,
                            })

                            const { url } = await client.authorize(redirectUrl.toString(), "code", { pkce: true })

                            return c.newResponse(url, 200)
                        })
                    }
                } as Adapter<{}>,
            },
            allow: async (input) => {
                const url = new URL(input.redirectURI);
                const hostname = url.hostname;
                if (hostname.endsWith("nestri.io")) return true;
                if (hostname === "localhost") return true;
                return true;
            },
            success: async (ctx, value) => {
                if (value.provider == "device") {
                    throw new Error("Device has no success");
                }

                const email = value.email;

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