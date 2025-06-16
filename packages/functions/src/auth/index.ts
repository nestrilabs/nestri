import { Resource } from "sst";
import { logger } from "hono/logger";
import { subjects } from "../subjects";
import { handle } from "hono/aws-lambda";
import { PasswordUI, Select } from "./ui";
import { issuer } from "@openauthjs/openauth";
import { User } from "@nestri/core/user/index";
import { Email } from "@nestri/core/email/index";
import { patchLogger } from "../utils/patch-logger";
import { handleDiscord, handleGithub } from "./utils";
import { DiscordAdapter, PasswordAdapter, GithubAdapter } from "./adapters";

patchLogger();

const app = issuer({
    select: Select(),
    theme: {
        title: "Nestri | Auth",
        primary: "#FF4F01",
        //TODO: Change this in prod
        logo: "https://nestri.io/logo.webp",
        favicon: "https://nestri.io/seo/favicon.ico",
        background: {
            light: "#F5F5F5",
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
                    // Do not debug show code in production
                    if (Resource.App.stage != "production") {
                        console.log("email & code:", email, code)
                    }
                    await Email.send(
                        "auth",
                        email,
                        `Nestri code: ${code}`,
                        `Your Nestri login code is ${code}`,
                    )
                },
            }),
        ),

    },
    allow: async (input) => {
        const url = new URL(input.redirectURI);
        const hostname = url.hostname;
        if (hostname.endsWith("nestri.io")) return true;
        if (hostname === "localhost") return true;
        return false;
    },
    success: async (ctx, value, req) => {
        if (value.provider === "password") {
            const email = value.email
            const username = value.username
            const matching = await User.fromEmail(email)

            //Sign Up
            if (username && !matching) {
                const userID = await User.create({
                    name: username,
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
                        name: user.username,
                        avatarUrl: user.avatar,
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

export const handler = handle(app);