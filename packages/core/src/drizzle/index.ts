export * from "drizzle-orm";
import { Resource } from "sst";
import { drizzle } from "drizzle-orm/aws-data-api/pg";
import { RDSDataClient } from "@aws-sdk/client-rds-data";

export const db = drizzle(new RDSDataClient({}), {
    // @ts-ignore
    database: Resource.Database.database,
    // @ts-ignore
    secretArn: Resource.Database.secretArn,
    // @ts-ignore
    resourceArn: Resource.Database.clusterArn,
});