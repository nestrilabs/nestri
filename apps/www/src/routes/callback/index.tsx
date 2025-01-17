import Nestri from "@nestri/sdk";
import { component$} from "@builder.io/qwik";
import { createClient } from "@openauthjs/openauth/client";
import { routeLoader$, type CookieOptions } from "@builder.io/qwik-city";

export const useLoggedIn = routeLoader$(async ({ query, url, cookie }) => {
    const code = query.get("code")
    if (code) {
        const redirect_uri = url.origin + "/callback"
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

            //TODO: Use subjects instead
            const currentProfile = await nestriClient.users.retrieve()
            const username = currentProfile.data.username
            return username
        }
    }
})

export default component$(() => {
    const username = useLoggedIn()
    console.log("username", username)

    return (
        <div class="w-screen h-screen flex justify-center items-center" >
            <span class="text-xl font-semibold flex items-center gap-2" >
                <div data-component="spinner">
                    <div>
                        {new Array(12).fill(0).map((i, k) => (
                            <div key={k} />
                        ))}
                    </div>
                </div>
                We are confirming your identity...</span>
        </div>
    )
})