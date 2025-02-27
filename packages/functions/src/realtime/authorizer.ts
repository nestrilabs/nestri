import { Resource } from "sst";
import { subjects } from "../subjects";
import { realtime } from "sst/aws/realtime";
import { createClient } from "@openauthjs/openauth/client";

export const handler = realtime.authorizer(async (token) => {
    const client = createClient({
        clientID: "realtime",
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

    if (result.subject.type == "machine") {
        return {
            //It can publish and listen to other instances under this machineID
            publish: [`${Resource.App.name}/${Resource.App.stage}/${result.subject.properties.machineID}/*`],
            subscribe: [`${Resource.App.name}/${Resource.App.stage}/${result.subject.properties.machineID}/*`],
        };
    }

    return {
        publish: [],
        subscribe: [],
    };
});