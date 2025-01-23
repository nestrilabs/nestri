import { Resource } from "sst";
import { realtime } from "sst/aws/realtime";

export const handler = realtime.authorizer(async (token) => {
    // Validate the token
    console.log("token", token)
    // Return the topics to subscribe and publish
    return {
        subscribe: [`${Resource.App.name}/${Resource.App.stage}/*`],
        publish: [`${Resource.App.name}/${Resource.App.stage}/*`],
    };
});