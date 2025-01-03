import type { Context } from "hono"
import type { Adapter } from "@openauthjs/openauth/adapter/adapter"
import { generateUnbiasedDigits, timingSafeCompare } from "@openauthjs/openauth/random"

export type ApiAdapterState =
    | {
        type: "start"
    }
    | {
        type: "code"
        resend?: boolean
        code: string
        claims: Record<string, string>
    }

export type ApiAdapterError =
    | {
        type: "invalid_code"
    }
    | {
        type: "invalid_claim"
        key: string
        value: string
    }

export function ApiAdapter<
    Claims extends Record<string, string> = Record<string, string>,
>(config: {
    length?: number
    request: (
        req: Request,
        state: ApiAdapterState,
        body?: Claims,
        error?: ApiAdapterError,
    ) => Promise<Response>
    sendCode: (claims: Claims, code: string) => Promise<void | ApiAdapterError>
}) {
    const length = config.length || 6
    function generate() {
        return generateUnbiasedDigits(length)
    }

    return {
        type: "api", // this is a miscellaneous name, for lack of a better one
        init(routes, ctx) {
            async function transition(
                c: Context,
                next: ApiAdapterState,
                claims?: Claims,
                err?: ApiAdapterError,
            ) {
                await ctx.set<ApiAdapterState>(c, "adapter", 60 * 60 * 24, next)
                const resp = ctx.forward(
                    c,
                    await config.request(c.req.raw, next, claims, err),
                )
                return resp
            }
            routes.get("/authorize", async (c) => {
                const resp = await transition(c, {
                    type: "start",
                })
                return resp
            })

            routes.post("/authorize", async (c) => {
                const code = generate()
                const body = await c.req.json()
                const state = await ctx.get<ApiAdapterState>(c, "adapter")
                const action = body.action

                if (action === "request" || action === "resend") {
                    const claims = body.claims as Claims
                    delete body.action
                    const err = await config.sendCode(claims, code)
                    if (err) return transition(c, { type: "start" }, claims, err)
                    return transition(
                        c,
                        {
                            type: "code",
                            resend: action === "resend",
                            claims,
                            code,
                        },
                        claims,
                    )
                }

                if (
                    body.action === "verify" &&
                    state.type === "code"
                ) {
                    const body = await c.req.json()
                    const compare = body.code
                    if (
                        !state.code ||
                        !compare ||
                        !timingSafeCompare(state.code, compare)
                    ) {
                        return transition(
                            c,
                            {
                                ...state,
                                resend: false,
                            },
                            body.claims,
                            { type: "invalid_code" },
                        )
                    }
                    await ctx.unset(c, "adapter")
                    return ctx.forward(
                        c,
                        await ctx.success(c, { claims: state.claims as Claims }),
                    )
                }
            })
        },
    } satisfies Adapter<{ claims: Claims }>
}

export type ApiAdapterOptions = Parameters<typeof ApiAdapter>[0]