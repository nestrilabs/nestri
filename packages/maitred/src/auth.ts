import { Resource } from "sst/resource";

export default function Authenticate(teamID: string) {
    const formData = new URLSearchParams()
    formData.append('grant_type', 'client_credentials');
    formData.append('client_id', 'device');
    formData.append('team_id', teamID);
    formData.append('provider', 'device');
    formData.append('client_secret', Resource.AuthFingerprintKey.value)
}