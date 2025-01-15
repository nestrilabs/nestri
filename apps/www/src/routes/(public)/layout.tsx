import Nestri from "@nestri/sdk";
import { NavBar } from "@nestri/ui";
import { component$, Slot } from "@builder.io/qwik";
import { type RequestHandler, routeLoader$ } from "@builder.io/qwik-city";
import { createClient } from "@openauthjs/openauth/client";

//FIXME: This seems not to work
// export const onRequest: RequestHandler = async ({ cookie, sharedMap }) => {
//   const access = cookie.get("access_token")
//   if (access) {
//     const bearerToken = access.value

//     const nestriClient = new Nestri({
//       bearerToken,
//       baseURL: "https://api.lauryn.dev.nestri.io"
//     })

//     const currentProfile = await nestriClient.users.retrieve()
//     sharedMap.set("profile", currentProfile.data)
//   }
// }

export const useLink = routeLoader$(async (ev) => {

    const client = createClient({
        clientID: "www",
        issuer: "https://auth.lauryn.dev.nestri.io"
    })

    const { url } = await client.authorize(ev.url.origin + "/callback", "code")

    return url
})

export default component$(() => {
    const loginUrl = useLink()

    return (
        <>
            <NavBar link={loginUrl.value} />
            <Slot />
        </>
    )
})