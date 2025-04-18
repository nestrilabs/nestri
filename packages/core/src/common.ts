import { sql } from "drizzle-orm";
import { z } from "zod";
import "zod-openapi/extend";

export namespace Common {
  export const IdDescription = `Unique object identifier.
The format and length of IDs may change over time.`;

  export const now = () => sql`now()`;
  export const utc = () => sql`now() at time zone 'utc'`;
}