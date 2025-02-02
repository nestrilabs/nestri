// import type Nestri from "@nestri/sdk"
import { component$, Slot } from "@builder.io/qwik";
// import { type RequestHandler } from "@builder.io/qwik-city";

// export const onRequest: RequestHandler = async ({ url, redirect, sharedMap }) => {
//     // const currentProfile = sharedMap.get("profile") as Nestri.Users.UserRetrieveResponse.Data | null
    
//     // if (!currentProfile) {
//     //     throw redirect(308, `${url.origin}`)
//     // }
// }

export default component$(() => {
    return (
        <Slot />
    )
})