import Nestri from "@nestri/sdk"
import { component$, Slot } from "@builder.io/qwik";
import { createClient } from "@openauthjs/openauth/client";
import { type CookieOptions, type RequestHandler } from "@builder.io/qwik-city";

export const onRequest: RequestHandler = async ({ query, url, cookie, redirect }) => {
    const access = cookie.get("access_token")
    if (!access) {
        const code = query.get("code")
        if (code) {
            const redirect_uri = url.origin + "/home"
            const cookieOptions: CookieOptions = {
                path: "/",
                sameSite: "Strict",  // Stronger than Lax for auth cookies
                secure: true,        // Only send cookies over HTTPS
                httpOnly: true,      // Prevent JavaScript access to cookies
                expires: new Date(Date.now() + 24 * 10 * 60 * 60 * 1000), // expires in like 10 days
            }

            const client = createClient({
                clientID: "www",
                issuer: "https://auth.lauryn.dev.nestri.io"
            })

            const tokens = await client.exchange(code, redirect_uri)

            if (!tokens.err) {
                const access_token = tokens.tokens.access
                const refresh_token = tokens.tokens.refresh

                cookie.set("access_token", access_token, cookieOptions)
                cookie.set("refresh_token", refresh_token, cookieOptions)

                const bearerToken = access_token

                const nestriClient = new Nestri({
                    bearerToken,
                    baseURL: "https://api.lauryn.dev.nestri.io"
                })

                const currentProfile = await nestriClient.users.retrieve()
                const username = currentProfile.data.username
                if (!url.pathname.toLowerCase().startsWith(`/${username.toLowerCase()}`)) {
                    throw redirect(308, `${url.origin}/${username}`)
                }
            }
        } else {
            throw redirect(308, url.origin)
        }
    }
    // else {
    // const bearerToken = access.value

    // const nestriClient = new Nestri({
    //     bearerToken,
    //     baseURL: "https://api.lauryn.dev.nestri.io"
    // })

    // const currentProfile = await nestriClient.users.retrieve()
    // console.log("currentProfile", currentProfile)
    // const username = currentProfile.data.username
    // if (!url.pathname.toLowerCase().startsWith(`/${username.toLowerCase()}`)) {
    //     throw redirect(308, `${url.origin}/${username}`)
    // }
    // }

}

export default component$(() => {
    return (
        <Slot />
    )
})