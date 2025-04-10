import { auth } from "./auth";
import { postgres } from "./postgres";

export const device = new sst.aws.Realtime("Realtime", {
    authorizer: {
        link: [auth, postgres],
        handler: "packages/functions/src/realtime/authorizer.handler"
    }
})