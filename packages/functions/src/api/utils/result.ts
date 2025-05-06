import { z } from "zod";
import { resolver } from "hono-openapi/zod";

export function Result<T extends z.ZodTypeAny>(schema: T) {
  return resolver(z.object({ data: schema }));
}
