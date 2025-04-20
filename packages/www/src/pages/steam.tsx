import { useOpenAuth } from "@openauthjs/solid"
import { useRealtime } from "../providers/realtime"
import { createEffect, createSignal } from "solid-js"

export function AuthSteamComponent() {
    const auth = useOpenAuth()
    const realtime = useRealtime()
    const [counter, setCounter] = createSignal(0)

    createEffect(async () => {
        const counter = await realtime.client.counter.get({
            params: {
                authToken: await auth.access()
            }
        });

        await counter.increment(30)
        const count = await counter.getCount()
        
        setCounter(count)
    })

    return (
        <div>
            {counter()}
        </div>
    )
}