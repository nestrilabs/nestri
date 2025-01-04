import { Resource } from "sst";
import { init } from "@instantdb/admin";
import schema from "../instant.schema";

const databaseClient = () => {
    console.log("appid", Resource.InstantAppId.value)
    console.log("token", Resource.InstantAdminToken.value)

    return init({
        appId: Resource.InstantAppId.value,
        adminToken: Resource.InstantAdminToken.value,
        schema
    })
}


export default databaseClient