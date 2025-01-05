import type * as Party from "partykit/server";

export async function tryAuthentication(req: Party.Request, lobby: Party.Lobby) {
    const authHeader = req.headers.get("authorization") ?? new URL(req.url).searchParams.get("authorization")
    if (authHeader) {
        const match = authHeader.match(/^Bearer (.+)$/);

        if (!match || !match[1]) {
            throw new Error("Bearer token not found or improperly formatted");
        }

        const bearerToken = match[1];

        if (bearerToken !== lobby.env.AUTH_FINGERPRINT) {
            throw new Error("Invalid authorization token");
        }

        return req// app.fetch(req as any, { room: this.room })
    }
    throw new Error("You are not authorized to be here")
}