import { SQSHandler } from "aws-lambda";
import { Actor } from "@nestri/core/actor";
import { Library } from "@nestri/core/library/index";

export const handler: SQSHandler = async (event) => {
    for (const record of event.Records) {
        const parsed = JSON.parse(
            record.body,
        ) as typeof Library.Events.Queue.$payload;

        await Actor.provide(
            parsed.metadata.actor.type,
            parsed.metadata.actor.properties,
            async () => {
               const processGames = parsed.properties.map(async(game)=>{
                // First check whether the base_game exists, if not get it

                // Add to user library

                })

                await Promise.allSettled(processGames)
            }
        )
    }
}