import { useTeam } from "./context"
import { createEffect } from "solid-js"
import { schema } from "@nestri/zero/schema"
import { useQuery } from "@rocicorp/zero/solid"
import { useOpenAuth } from "@openauthjs/solid"
import { Query, Schema, Zero } from "@rocicorp/zero"
import { useAccount } from "@nestri/www/providers/account"
import { createInitializedContext } from "@nestri/www/common/context"

export const { use: useZero, provider: ZeroProvider } =
    createInitializedContext("ZeroContext", () => {
        const auth = useOpenAuth()
        const account = useAccount()
        const team = useTeam()
        const zero = new Zero({
            schema: schema,
            auth: () => auth.access(),
            userID: account.current.email,
            storageKey: team().id,
            server: import.meta.env.VITE_ZERO_URL,
        })

        return {
            mutate: zero.mutate,
            query: zero.query,
            client: zero,
            ready: true,
        };
    });

export function usePersistentQuery<TSchema extends Schema, TTable extends keyof TSchema['tables'] & string, TReturn>(querySignal: () => Query<TSchema, TTable, TReturn>) {
    const team = useTeam()
    //@ts-ignore
    const q = () => querySignal().where("team_id", "=", team().id).where("time_deleted", "IS", null)
    createEffect(() => {
        q().preload()
    })
    return useQuery<TSchema, TTable, TReturn>(q)
}