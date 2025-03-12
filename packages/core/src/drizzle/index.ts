export * from "drizzle-orm";
import { Resource } from "sst";
import { drizzle } from "drizzle-orm/aws-data-api/pg";
import { RDSDataClient } from "@aws-sdk/client-rds-data";

export const db = drizzle(new RDSDataClient({}), {
    database: Resource.Postgres.database,
    secretArn: Resource.Postgres.secretArn,
    resourceArn: Resource.Postgres.clusterArn,
});