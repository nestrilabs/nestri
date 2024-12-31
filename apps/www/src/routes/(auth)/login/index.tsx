import { $, component$, useVisibleTask$ } from "@builder.io/qwik";
import { createClient } from "@openauthjs/openauth/client";

function getHashParams(url: URL) {
    const urlString = url.toString()
    const hash = urlString.substring(urlString.indexOf('#') + 1); // Extract the part after the #
    console.log("url", hash)
    const params = new URLSearchParams(hash);
    const paramsObj = {} as any;
    for (const [key, value] of params.entries()) {
        paramsObj[key] = decodeURIComponent(value);
    }
    console.log(paramsObj)
    return paramsObj;
}

function removeURLParams() {
    const newURL = window.location.origin + window.location.pathname; // Just origin and path
    window.location.replace(newURL);
}

export default component$(() => {

    const login = $(async () => {
        const client = createClient({
            clientID: "www",
            issuer: "https://auth.lauryn.dev.nestri.io"
        })

        const { url } = await client.authorize("http://localhost:5173/login", "token", { pkce: true })
        window.location.href = url
    })

    useVisibleTask$(async () => {
        const urlObj = new URL(window.location.href);
        const params = getHashParams(urlObj)
        if (params.access_token && params.refresh_token) {

            localStorage.setItem("access_token", params.access_token)
            localStorage.setItem("refresh_token", params.refresh_token)
            removeURLParams()
        }


    })
    return (
        <div class="h-screen w-screen flex justify-center items-center">
            <button class="px-2 py-1 font-title text-lg bg-gray-400 rounded-lg" onClick$={login}>
                Login
            </button>
        </div>
    )
})