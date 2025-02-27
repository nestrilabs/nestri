export const device = new sst.aws.Realtime("Realtime", {
    authorizer: "./packages/functions/src/realtime/authorizer.handler"
})