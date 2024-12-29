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
import { Machine } from "@nestri/core/machine/index"
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

export default {
    async fetch(request: CFRequest, env: Env, ctx: ExecutionContext) {
        const location = `${request.cf.country},${request.cf.continent}`
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
                        if (!name) {
                            throw new Error("Name of the machine is required");
                        }

                        return {
                            fingerprint,
                            email,
                            name,
                        };
                    },
                    init() { },
                } as Adapter<{
                    email: string;
                    fingerprint: string;
                    name: string;
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
                const email = value.provider === "code" ? value.claims.email : value.email;
                
                const token = await User.create(email);

                if (value.provider === "ssh") {
                    // Register the machine if it is not already registered
                    const matchingUser = await User.fromEmail(email);
                    const matchingMachines = await Machine.fromFingerprint(value.fingerprint)
                    if (matchingMachines.length === 0) {
                        await Machine.create({ fingerprint: value.fingerprint, owner: matchingUser.id, name: value.name, location })
                    }
                }

                return ctx.subject("user", {
                    accessToken: token,
                });
            },
        }).fetch(request, env, ctx)
    }
}