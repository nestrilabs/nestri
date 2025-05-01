import "zod-openapi/extend";
import { Resource } from "sst"
import type { Env } from "hono";
import { Select } from "./ui/select";
import { subjects } from "./subjects"
import { logger } from "hono/logger";
import { PasswordUI } from "./ui/password"
import { patchLogger } from "./log-polyfill";
import { issuer } from "@openauthjs/openauth";
import { User } from "@nestri/core/user/index"
import { Email } from "@nestri/core/email/index";
import { Machine } from "@nestri/core/machine/index";
import { GithubAdapter } from "./ui/adapters/github";
import { handleDiscord, handleGithub } from "./utils";
import { DiscordAdapter } from "./ui/adapters/discord";
import { PasswordAdapter } from "./ui/adapters/password";
import { MemoryStorage } from "@openauthjs/openauth/storage/memory";
import { type Provider } from "@openauthjs/openauth/provider/provider";

function formatUsername(username: string) {
    const words = username.split("_");

    const capitalizedWords = words.map(word =>
        word.charAt(0).toUpperCase() + word.slice(1)
    );

    return capitalizedWords.join(" ");
}


const app = issuer({
    select: Select({
        providers: {
            machine: {
                hide: true
            }
        }
    }),
    //TODO: Create our own Storage
    storage: MemoryStorage({
        persist: process.env.STORAGE //"/tmp/persist.json",
    }),
    theme: {
        title: "Nestri | Auth",
        primary: "#FF4F01",
        //TODO: Change this in prod
        logo: "https://nestri.io/logo.webp",
        favicon: "https://nestri.io/seo/favicon.ico",
        background: {
            light: "#f5f5f5 ",
            dark: "#171717"
        },
        radius: "lg",
        font: {
            family: "Geist, sans-serif",
        },
        css: `@import url('https://fonts.googleapis.com/css2?family=Geist:wght@100;200;300;400;500;600;700;800;900&display=swap');`,
    },
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
            scopes: ["email", "identify"]
        }),
        password: PasswordAdapter(
            PasswordUI({
                sendCode: async (email, code) => {
                    console.log("email & code:", email, code)
                    await Email.send(
                        "auth",
                        email,
                        `Nestri code: ${code}`,
                        `Your Nestri login code is ${code}`,
                    )
                },
            }),
        ),
        machine: {
            type: "machine",
            async client(input) {
                // FIXME: Do we really need this?
                // if (input.clientSecret !== Resource.AuthFingerprintKey.value) {
                //     throw new Error("Invalid authorization token");
                // }

                const fingerprint = input.params.fingerprint;
                if (!fingerprint) {
                    throw new Error("Hostname is required");
                }

                return {
                    fingerprint,
                };
            },
            init() { }
        } as Provider<{ fingerprint: string; }>,
    },
    allow: async (input) => {
        const url = new URL(input.redirectURI);
        const hostname = url.hostname;
        if (hostname.endsWith("nestri.io")) return true;
        if (hostname === "localhost") return true;
        return false;
    },
    success: async (ctx, value, req) => {
        if (value.provider === "machine") {
            const countryCode = req.headers.get('CloudFront-Viewer-Country') || 'Unknown'
            const country = req.headers.get('CloudFront-Viewer-Country-Name') || 'Unknown'
            const latitude = Number(req.headers.get('CloudFront-Viewer-Latitude')) || 0
            const longitude = Number(req.headers.get('CloudFront-Viewer-Longitude')) || 0
            const timezone = req.headers.get('CloudFront-Viewer-Time-Zone') || 'Unknown'
            const fingerprint = value.fingerprint

            const existing = await Machine.fromFingerprint(fingerprint)
            if (!existing) {
                const machineID = await Machine.create({
                    countryCode,
                    country,
                    fingerprint,
                    timezone,
                    location: {
                        latitude,
                        longitude
                    },
                    //FIXME: Make this better
                    // userID: null
                })
                return ctx.subject("machine", {
                    machineID,
                    fingerprint
                });
            }

            return ctx.subject("machine", {
                machineID: existing.id,
                fingerprint
            });
        }

        // TODO: This works, so use this while registering the task
        // console.log("country_code", req.headers.get('CloudFront-Viewer-Country'))
        // console.log("country_name", req.headers.get('CloudFront-Viewer-Country-Name'))
        // console.log("latitude", req.headers.get('CloudFront-Viewer-Latitude'))
        // console.log("longitude", req.headers.get('CloudFront-Viewer-Longitude'))
        // console.log("timezone", req.headers.get('CloudFront-Viewer-Time-Zone'))

        if (value.provider === "password") {
            const email = value.email
            const username = value.username
            const matching = await User.fromEmail(email)

            //Sign Up
            if (username && !matching) {
                const userID = await User.create({
                    name: formatUsername(username),
                    username,
                    email,
                });

                if (!userID) throw new Error("Error creating user");

                return ctx.subject("user", {
                    userID,
                    email
                }, {
                    subject: userID
                });

            } else if (matching) {
                await User.acknowledgeLogin(matching.id)

                //Sign In
                return ctx.subject("user", {
                    userID: matching.id,
                    email
                }, {
                    subject: matching.id
                });
            }
        }

        let user;

        if (value.provider === "github") {
            const access = value.tokenset.access;
            user = await handleGithub(access)
        }

        if (value.provider === "discord") {
            const access = value.tokenset.access
            user = await handleDiscord(access)
        }

        if (user) {
            try {
                const matching = await User.fromEmail(user.primary.email);

                //Sign Up
                if (!matching) {
                    const userID = await User.create({
                        email: user.primary.email,
                        username: user.username.toLowerCase(),
                        avatarUrl: user.avatar,
                        name: user.name ?? formatUsername(user.username.toLowerCase())
                    });

                    if (!userID) throw new Error("Error creating user");

                    return ctx.subject("user", {
                        userID,
                        email: user.primary.email
                    }, {
                        subject: userID
                    });
                } else {
                    await User.acknowledgeLogin(matching.id)

                    //Sign In
                    return await ctx.subject("user", {
                        userID: matching.id,
                        email: user.primary.email
                    }, {
                        subject: matching.id
                    });
                }

            } catch (error) {
                console.error("error registering the user", error)
            }

        }

        throw new Error("Something went seriously wrong");
    },
}).use(logger())

patchLogger();

export default {
    port: 3002,
    idleTimeout: 255,
    fetch: (req: Request, env: Env) =>
        app.fetch(req, env, {
            waitUntil: (fn) => fn,
            passThroughOnException: () => { },
        }),
};