import { urls } from "./api";
import { postgres } from "./postgres";

export const device = new sst.aws.Realtime("Realtime", {
    authorizer: {
        link: [urls, postgres],
        handler: "./packages/functions/src/realtime/authorizer.handler"
    }
})