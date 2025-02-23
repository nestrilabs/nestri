export * from "drizzle-orm";
import { Resource } from "sst";
import { neon } from "@neondatabase/serverless";
// import { Client } from "@neondatabase/serverless"
import { drizzle } from "drizzle-orm/neon-http";
// import { drizzle } from "drizzle-orm/node-postgres";
// import { Pool } from "pg"

// const client = new Client({
//     password: "npg_CrToY1ysGa7N",
//     database: "neondb",
//     user: "neondb_owner",
//     host: "ep-delicate-bush-a4w4tnmb.us-east-1.aws.neon.tech",
//     ssl: true
// })

// const url = await client.connect()

const url = `postgresql://neondb_owner:npg_CrToY1ysGa7N@ep-delicate-bush-a4w4tnmb.us-east-1.aws.neon.tech/neondb?sslmode=require`

const client = neon(`postgres://${Resource.Database.user}:${Resource.Database.password}@${Resource.Database.host}/${Resource.Database.name}?sslmode=require`)
// const client = neon(`postgresql://neondb_owner:npg_CrToY1ysGa7N@ep-delicate-bush-a4w4tnmb.us-east-1.aws.neon.tech/neondb?sslmode=require`)

// const client = new Pool({connectionString: url})

export const db = drizzle(client)
// export const db = drizzle(url, {
//     // client,
//     logger:
//         process.env.DRIZZLE_LOG === "true"
//             ? {
//                 logQuery(query, params) {
//                     console.log("query", query);
//                     console.log("params", params);
//                 },
//             }
//             : undefined,
// });