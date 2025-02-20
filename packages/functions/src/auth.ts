import { Resource } from "sst"
import { Select } from "./ui/select";
import { subjects } from "./subjects"
import { logger } from "hono/logger";
import { handle } from "hono/aws-lambda";
import { PasswordUI } from "./ui/password"
import { issuer } from "@openauthjs/openauth";
import { Email } from "@nestri/core/email/index"
import { Users } from "@nestri/core/user/index"
import { Teams } from "@nestri/core/team/index"
import { Profiles } from "@nestri/core/profile/index"
import { handleDiscord, handleGithub } from "./utils";
import { GithubAdapter } from "./ui/adapters/github";
import { DiscordAdapter } from "./ui/adapters/discord";
import { Instances } from "@nestri/core/instance/index"
import { PasswordAdapter } from "./ui/adapters/password"
import { type Provider } from "@openauthjs/openauth/provider/provider"
// import { Subscriptions } from "@nestri/core/subscription/index";
// import type { Subscription } from "./type";

type OauthUser = {
    primary: {
        email: any;
        primary: any;
        verified: any;
    };
    avatar: any;
    username: any;
}
const app = issuer({
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
        css: `
                    @import url('https://fonts.googleapis.com/css2?family=Geist:wght@100;200;300;400;500;600;700;800;900&display=swap');
                  `,
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
                const teamSlug = input.params.team;
                if (!teamSlug) {
                    throw new Error("Team slug is required");
                }

                const hostname = input.params.hostname;
                if (!hostname) {
                    throw new Error("Hostname is required");
                }

                return {
                    hostname,
                    teamSlug
                };
            },
            init() { }
        } as Provider<{ teamSlug: string; hostname: string; }>,
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
            const team = await Teams.fromSlug(value.teamSlug)
            console.log("team", team)
            console.log("teamSlug", value.teamSlug)
            if (team) {
                await Instances.create({ hostname: value.hostname, teamID: team.id })

                return await ctx.subject("device", {
                    teamSlug: value.teamSlug,
                    hostname: value.hostname,
                })
            }
        }

        if (value.provider === "password") {
            const email = value.email
            const username = value.username
            const token = await Users.create(email)
            const usr = await Users.fromEmail(email);
            const exists = await Profiles.fromOwnerID(usr.id)
            if (username && !exists) {
                await Profiles.create({ owner: usr.id, username })
            }

            return await ctx.subject("user", {
                accessToken: token,
                userID: usr.id,
            });

        }

        let user = undefined as OauthUser | undefined;

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
                const token = await Users.create(user.primary.email)
                const usr = await Users.fromEmail(user.primary.email);
                const exists = await Profiles.fromOwnerID(usr.id)
                console.log("exists", exists)
                if (!exists) {
                    await Profiles.create({ owner: usr.id, avatarUrl: user.avatar, username: user.username })
                }

                return await ctx.subject("user", {
                    accessToken: token,
                    userID: usr.id,
                });

            } catch (error) {
                console.error("error registering the user", error)
            }

        }

        throw new Error("Something went seriously wrong");
    },
}).use(logger())

export const handler = handle(app)
