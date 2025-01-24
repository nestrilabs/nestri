import { Resource } from "sst";
import { realtime } from "sst/aws/realtime";

export const handler = realtime.authorizer(async (token) => {
    // Validate the token
    console.log("token", token)
    //TODO: Use the following criteria for a topic - team-slug/container-id (container ids are not unique globally)
    //TODO: Allow the authorizer to subscriber/publisher to listen on - team-slug topics only (as the container will listen on the team-slug/container-id topic to be specific)
    // Return the topics to subscribe and publish
    return {
        subscribe: [`${Resource.App.name}/${Resource.App.stage}/*`],
        publish: [`${Resource.App.name}/${Resource.App.stage}/*`],
    };
});