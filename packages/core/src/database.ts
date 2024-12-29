import { Resource } from "sst";
import { init } from "@instantdb/admin";
import schema from "../instant.schema";

const databaseClient = () => init({
    appId: Resource.InstantAppId.value,
    adminToken: Resource.InstantAdminToken.value,
    schema: schema
});

export default databaseClient