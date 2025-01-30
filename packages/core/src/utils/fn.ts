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

export function doubleFn<
    Arg1 extends ZodSchema,
    Arg2 extends ZodSchema,
    Callback extends (arg1: z.output<Arg1>, arg2: z.output<Arg2>) => any,
>(arg1: Arg1, arg2: Arg2, cb: Callback) {
    const result = function (input: z.input<typeof arg1>, input2: z.input<typeof arg2>): ReturnType<Callback> {
        const parsed = arg1.parse(input);
        const parsed2 = arg2.parse(input2);
        return cb.apply(cb, [parsed as any, parsed2 as any]);
    };
    result.schema = arg1;
    return result;
}