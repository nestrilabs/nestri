// This is for the websocket/MQTT endpoint that helps the API communicate with the container
// [API] <-> party <-websocket-> container
// The container is it's own this, and can listen to Websocket connections to start or stop a Steam Game

// export const party = new sst.aws.Realtime("Party", {
//     authorizer: "packages/functions/src/authorizer.handler"
// });