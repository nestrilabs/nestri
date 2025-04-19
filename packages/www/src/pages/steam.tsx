import { useRealtime } from "../providers/realtime"

export async function SteamComponent() {
    const realtime = useRealtime()

    const counter = await realtime.client.counter.get();

    await counter.getCount()

    return (
        <div></div>
    )
}