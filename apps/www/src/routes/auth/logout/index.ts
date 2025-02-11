import { type RequestHandler } from "@builder.io/qwik-city";

export const onGet: RequestHandler = async ({ cookie, redirect, url }) => {
    cookie.delete("access_token")
    cookie.delete("refresh_token")
    throw redirect(308, url.origin)
}
