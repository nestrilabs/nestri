import { NavBar } from "@nestri/ui";
import { component$, Slot } from "@builder.io/qwik";
import { routeLoader$ } from "@builder.io/qwik-city";
import { createClient } from "@openauthjs/openauth/client";

export const useLink = routeLoader$(async (ev) => {

    const client = createClient({
        clientID: "www",
        issuer: "https://auth.lauryn.dev.nestri.io"
    })

    const { url } = await client.authorize(ev.url.origin + "/home", "code")

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