import { urls } from "./api";
import { database } from "./database";

export const device = new sst.aws.Realtime("Realtime", {
    authorizer: {
        link: [urls, database],
        handler: "./packages/functions/src/realtime/authorizer.handler"
    }
})