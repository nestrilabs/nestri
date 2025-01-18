// import Nestri from "@nestri/sdk";
import { NavBar } from "@nestri/ui";
import { component$, Slot } from "@builder.io/qwik";
import { createClient } from "@openauthjs/openauth/client";
import { type RequestHandler, routeLoader$ } from "@builder.io/qwik-city";

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

export const onRequest: RequestHandler = async ({url, sharedMap }) => {
    // const access = cookie.get("access_token")
    // if (!access) {
        const client = createClient({
            clientID: "www",
            issuer: "https://auth.nestri.io"
        })

        const auth = await client.authorize(url.origin + "/callback", "code")
        sharedMap.set("auth_url", auth.url)
    // }
}

export const useLink = routeLoader$(async ({sharedMap}) => {
    const url =  sharedMap.get("auth_url") as string

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