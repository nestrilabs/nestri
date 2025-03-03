import {
    IoTDataPlaneClient,
    PublishCommand,
} from "@aws-sdk/client-iot-data-plane";
import { useMachine } from "../actor";
import { Resource } from "sst";

export module Realtime {
    const client = new IoTDataPlaneClient({});

    export async function publish(
        message: any
    ) {
        const fingerprint = useMachine();
        await client.send(
            new PublishCommand({
                payload: Buffer.from(
                    JSON.stringify({
                        message
                    }),
                ),
                topic: `${Resource.App.name}/${Resource.App.stage}/${fingerprint}/`,
            }),
        );
    }
}