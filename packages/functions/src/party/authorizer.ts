import { Resource } from "sst";
import { subjects } from "../subjects";
import { realtime } from "sst/aws/realtime";
import { createClient } from "@openauthjs/openauth/client";

export const handler = realtime.authorizer(async (token) => {
    //TODO: Use the following criteria for a topic - team-slug/container-id (container ids are not unique globally)
    //TODO: Allow the authorizer to subscriber/publisher to listen on - team-slug topics only (as the container will listen on the team-slug/container-id topic to be specific)
    // Return the topics to subscribe and publish

    const client = createClient({
        clientID: "api",
        issuer: Resource.Urls.auth
    });

    const result = await client.verify(subjects, token);

    if (result.err) {
        console.log("error", result.err)
        return {
            subscribe: [],
            publish: [],
        };
    }

    if (result.subject.type != "device") {
        return {
            subscribe: [],
            publish: [],
        };
    }

    return {
        //It can publish and listen to other instances under this team
        subscribe: [`${Resource.App.name}/${Resource.App.stage}/${result.subject.properties.teamSlug}/*`],
        publish: [`${Resource.App.name}/${Resource.App.stage}/${result.subject.properties.teamSlug}/*`],
    };
});