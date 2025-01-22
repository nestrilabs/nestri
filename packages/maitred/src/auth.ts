import { $ } from "bun";
import { log } from "@/utils";
import { Resource } from "sst/resource";


export module Auth {
    export const getCredentials = async(teamID: string) => {
        const hostname = (await $`cat /etc/hostname`.text()).replace("\n", "")
        const formData = new URLSearchParams()
        formData.append('grant_type', 'client_credentials');
        formData.append('client_id', 'device');
        // formData.append('hostname', hostname);
        formData.append('team', teamID);
        formData.append('provider', 'device');
        formData.append('client_secret', Resource.AuthFingerprintKey.value)

        const response = await fetch(`${Resource.Auth.url}/token`, {
            method: 'POST',
            body: formData,
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            }
        });

        // Check if response is not ok
        if (!response.ok) {
            const errorBody = await response.text();
            // console.log(errorBody);
            log.Error(errorBody)
            process.exit(1)
            // throw new Error(`Failed to auth: ${errorBody}`);
        }

        // Parse and return the credentials
        const credentials = await response.json();
        return credentials;
    }
}