import fs from "node:fs";
// import postgres from "postgres";
import { db, sql } from "@nestri/core/drizzle/index";

export async function handler() {
    //   const sql = postgres(process.env.ZERO_UPSTREAM_DB!);
    const perms = fs.readFileSync("permissions.sql", "utf8");
    //   await sql.unsafe(perms);
    await db.execute(sql.raw(perms))
}