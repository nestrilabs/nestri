import { resolver } from 'hono-openapi/zod';
import { z } from 'zod';

export function Result<T extends z.ZodTypeAny>(schema: T) {
	return resolver(z.object({ data: schema }));
}
