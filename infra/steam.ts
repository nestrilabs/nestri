export const gameQueue = new sst.aws.Queue("GameQueue", {
    fifo: true,
    visibilityTimeout: "5 minutes",
})

gameQueue.subscribe({ handler: "packages/functions/src/queue/game.handler", timeout: "5 minutes" })