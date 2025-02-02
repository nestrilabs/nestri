import Nestri from "@nestri/sdk";
import { HomeNavBar } from "@nestri/ui";
import { server$ } from "@builder.io/qwik-city";
import { $, component$, Slot } from "@builder.io/qwik"

export const getUserProfile = server$(
    async function () {
        const access = this.cookie.get("access_token")
        if (access) {
            const bearerToken = access.value

            const nestriClient = new Nestri({ bearerToken, maxRetries: 5 })
            const currentProfile = await nestriClient.users.retrieve()
            return currentProfile.data;
        }
    }
);

export default component$(() => {

    return (
        <>
            {/* <HomeNavBar getUserProfile$={$(async () => { return await getUserProfile() })} /> */}
            <Slot />
        </>
    )
})