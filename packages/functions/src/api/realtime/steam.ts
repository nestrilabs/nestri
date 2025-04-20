import { Resource } from "sst";
import { subjects } from "../../subjects";
import { actor, UserError } from "actor-core";
import { withActor } from "@nestri/core/actor";
import { Steam } from "@nestri/core/steam/index";
import { Member } from "@nestri/core/member/index";
import { createClient } from "@openauthjs/openauth/client";
import { SteamAuthClient, SteamAuthEvent } from "@nestri/steam";

const client = createClient({
    clientID: "realtime",
    issuer: Resource.Auth.url
});

export const steam = actor({
    state: { count: 0 },
    async createConnState(_c, { params }: { params: { authToken: string, teamID: string; } }) {
        const teamID = params.teamID;
        const authToken = params.authToken;
        
        if (!authToken) {
            throw new Error("No auth token provided");
        }

        if (!teamID) {
            throw new Error("No teamID was provided")
        }

        const result = await client.verify(subjects, authToken);

        if (result.err) {
            throw new Error("Invalid auth token");
        }

        if (result.subject.type != "user") {
            throw new Error("Unauthorised entity")
        }

        const email = result.subject.properties.email

        await withActor(
            {
                type: "system",
                properties: {
                    teamID,
                },
            },
            async () => {
                const member = await Member.fromEmail(email);

                if (!member) {
                    throw new Error("This member does not exist on this team")
                }
            })

        await Member.nowSeen(email);

        return {
            userID: result.subject.properties.userID,
            email: result.subject.properties.email
        }
    },
    actions: {
        login: async (c) => {
            const steam = new SteamAuthClient()

            const healthy = await steam.checkHealth();

            if (!healthy) {
                throw new UserError("Steam server is not online", {
                    code: "steam_server_dead",
                });
            }

            steam.on(SteamAuthEvent.CHALLENGE_URL, (url: string) => {
                c.conn.send("challenge_url", { url })
            })

            steam.on(SteamAuthEvent.STATUS_UPDATE, (message: string) => {
                c.conn.send("status_update", { message })
            })

            steam.on(SteamAuthEvent.LOGIN_ERROR, () => {
                c.conn.send("login_error", { message: "Something went wrong while logging you in" })
            })

            steam.on(SteamAuthEvent.CREDENTIALS, async (creds: { refreshToken: any; username: any; }) => {
                await Steam.createCredential({
                    accessToken: creds.refreshToken,
                    username: creds.username
                })

                // After getting the credentials, close everything for now???
                steam.destroy()

                c.conn.send("login_success", { message: "Steam authentication was succesful" })
            })

            await steam.startQRLogin()
        }
    },
});