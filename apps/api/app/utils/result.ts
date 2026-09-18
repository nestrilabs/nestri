import { resolver } from 'hono-openapi/zod';
import { z } from 'zod';

export function Result<T extends z.ZodTypeAny>(schema: T) {
	return resolver(z.object({ data: schema }));
}

/**
 * A result that also carries where the caller's allowance stands.
 *
 * Every surface that can start a run has to show what it will cost and what
 * remains, so the answer travels with the thing that spends it rather than
 * needing a second call nobody will make. It sits beside `data` and not inside
 * it, because it describes the account rather than the resource.
 */
export function ResultWithBilling<T extends z.ZodTypeAny, B extends z.ZodTypeAny>(
	schema: T,
	billing: B
) {
	return resolver(z.object({ data: schema, billing }));
}
