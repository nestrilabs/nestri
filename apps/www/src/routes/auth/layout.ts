import { type RequestHandler } from "@builder.io/qwik-city";

export const onRequest: RequestHandler = async ({ json, url }) => {
    // const access = cookie.get("access_token")
    // if (!access) {
    //     throw json(401, { error: "You are not authorized" })
    // }

    if (!url.hostname.endsWith("nestri.io") && !url.hostname.endsWith("localhost")) {
        throw json(404, { error: "We could not serve your request" })
    }

}