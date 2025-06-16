import { Zero } from "@rocicorp/zero"
import { schema } from "@nestri/zero/schema"
import { useOpenAuth } from "@openauthjs/solid"
import { useAccount } from "@nestri/www/providers/account"
import { createInitializedContext } from "@nestri/www/common/context"

export const { use: useZero, provider: ZeroProvider } =
    createInitializedContext("ZeroContext", () => {
        const account = useAccount()
        const auth = useOpenAuth()
        const zero = new Zero({
            schema,
            auth: () => auth.access(),
            userID: account.current.id,
            server: import.meta.env.VITE_ZERO_URL,
        })

        return {
            mutate: zero.mutate,
            query: zero.query,
            client: zero,
            ready: true,
        };
    });