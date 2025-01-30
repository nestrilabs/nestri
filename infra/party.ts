// This is for the websocket/MQTT endpoint that helps the API communicate with the container
// [API] <-> party <-websocket-> container
// The container is it's own this, and can listen to Websocket connections to start or stop a Steam Game

import { authFingerprintKey } from "./auth";
import { ecsCluster, gpuTaskDefinition } from "./cluster";

export const party = new sst.aws.Realtime("Party", {
    authorizer: "packages/functions/src/party/authorizer.handler"
});

// export const partyFn = new sst.aws.Function("NestriPartyFn", {
//     handler: "packages/functions/src/party/create.handler",
//     // link: [queue],
//     link: [authFingerprintKey],
//     environment: {
//         TASK_DEFINITION: gpuTaskDefinition.arn,
//         // AUTH_FINGERPRINT: authFingerprintKey.result,
//         ECS_CLUSTER: ecsCluster.arn,
//     },
//     permissions: [
//         {
//             effect: "allow",
//             actions: ["ecs:RunTask"],
//             resources: [gpuTaskDefinition.arn]
//         }
//     ],
//     url: true,
// });

// export const outputs = {
//     partyFunction: partyFn.url
// }