import {
    IoTDataPlaneClient,
    PublishCommand,
} from "@aws-sdk/client-iot-data-plane";
import { Resource } from "sst";
import { Actor } from "../actor";

export namespace Realtime {
    const client = new IoTDataPlaneClient({});

    export async function publish(message: any, subTopic?: string) {
        const fingerprint = Actor.fingerprint();
        let topic = `${Resource.App.name}/${Resource.App.stage}/${fingerprint}/`;
        if (subTopic)
            topic = `${topic}${subTopic}`;

        await client.send(
            new PublishCommand({
                payload: Buffer.from(JSON.stringify(message)),
                topic: topic,
            })
        );
    }
}