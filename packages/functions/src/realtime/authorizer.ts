import { Resource } from "sst";
import { subjects } from "../subjects";
import { realtime } from "sst/aws/realtime";
import { createClient } from "@openauthjs/openauth/client";

const client = createClient({
    clientID: "realtime",
    issuer: Resource.Auth.url
});

export const handler = realtime.authorizer(async (token) => {

    console.log("token", token)

    const result = await client.verify(subjects, token);

    if (result.err) {
        console.log("error", result.err)
        return {
            subscribe: [],
            publish: [],
        };
    }

    if (result.subject.type == "machine") {
        console.log("machineID", result.subject.properties.machineID)
        console.log("fingerprint", result.subject.properties.fingerprint)
        
        return {
            //It can publish and listen to other instances under this machineID
            publish: [`${Resource.App.name}/${Resource.App.stage}/${result.subject.properties.fingerprint}/*`],
            subscribe: [`${Resource.App.name}/${Resource.App.stage}/${result.subject.properties.fingerprint}/*`],
        };
    }

    return {
        publish: [],
        subscribe: [],
    };
});