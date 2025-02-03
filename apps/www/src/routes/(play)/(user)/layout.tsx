import Nestri from "@nestri/sdk";
import { HomeNavBar } from "@nestri/ui";
import { server$ } from "@builder.io/qwik-city";
import { $, component$, Slot } from "@builder.io/qwik"

const cookieOptions = {
    path: "/",
    sameSite: "lax" as const,
    secure: false,        // Only send cookies over HTTPS
    //FIXME: This causes weird issues in Qwik
    httpOnly: true,      // Prevent JavaScript access to cookies
    expires: new Date(Date.now() + 24 * 10 * 60 * 60 * 1000), // expires in like 10 days
}
export const getUserProfile = server$(
    async function () {
        const userData = this.cookie.get("profile_data")
        if (userData) {
            const user = userData.json() as Nestri.Users.UserRetrieveResponse.Data
            return user
        } else {
            const access = this.cookie.get("access_token")
            if (access) {
                const bearerToken = access.value

                const nestriClient = new Nestri({ bearerToken, maxRetries: 5 })
                const currentProfile = await nestriClient.users.retrieve()
                this.cookie.set("profile_data", JSON.stringify(currentProfile.data), cookieOptions)
                return currentProfile.data;
            }
        }
    }
);

export default component$(() => {

    return (
        <>
            <HomeNavBar getUserProfile$={$(async () => { return await getUserProfile() })} />
            <Slot />
        </>
    )
})