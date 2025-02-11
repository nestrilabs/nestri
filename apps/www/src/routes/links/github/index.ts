import { type RequestHandler } from "@builder.io/qwik-city"

export const onGet: RequestHandler = async ({ redirect }) => {

    throw redirect(308, "https://github.com/nestrilabs/nestri")
}