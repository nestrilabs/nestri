import { ZodSchema, z } from "zod";

export function fn<
    Arg1 extends ZodSchema,
    Callback extends (arg1: z.output<Arg1>) => any,
>(arg1: Arg1, cb: Callback) {
    const result = function (input: z.input<typeof arg1>): ReturnType<Callback> {
        const parsed = arg1.parse(input);
        return cb.apply(cb, [parsed as any]);
    };
    result.schema = arg1;
    return result;
}