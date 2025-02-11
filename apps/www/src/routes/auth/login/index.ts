import { type RequestHandler } from "@builder.io/qwik-city";
import { createClient } from "@openauthjs/openauth/client";

export const onGet: RequestHandler = async ({ cookie, redirect, url }) => {
    cookie.delete("access_token")
    cookie.delete("refresh_token")

    const client = createClient({
        clientID: "www",
        issuer: "https://auth.nestri.io"
    })

    const auth = await client.authorize(url.origin + "/auth/callback", "code")

    throw redirect(308, auth.url)
}