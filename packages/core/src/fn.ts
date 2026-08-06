import { z, type ZodType } from 'zod';

// Explicit return type structures capturing the .schema attachment
export type WrappedFn<Arg1 extends ZodType, Callback extends (...args: any[]) => any> = ((
	input: z.input<Arg1>
) => ReturnType<Callback>) & { schema: Arg1 };

export type WrappedDoubleFn<
	Arg1 extends ZodType,
	Arg2 extends ZodType,
	Callback extends (...args: any[]) => any
> = ((input1: z.input<Arg1>, input2: z.input<Arg2>) => ReturnType<Callback>) & {
	schemas: [Arg1, Arg2];
};

// Single Argument Function
export function fn<Arg1 extends ZodType, Callback extends (arg: z.output<Arg1>) => any>(
	arg1: Arg1,
	cb: Callback
): WrappedFn<Arg1, Callback> {
	const result = Object.assign(
		function (input: z.input<Arg1>): ReturnType<Callback> {
			const parsed = arg1.parse(input);
			return cb(parsed);
		},
		{ schema: arg1 }
	);

	return result;
}

// Double Argument Function
export function doublefn<
	Arg1 extends ZodType,
	Arg2 extends ZodType,
	Callback extends (arg1: z.output<Arg1>, arg2: z.output<Arg2>) => any
>(arg1: Arg1, arg2: Arg2, cb: Callback): WrappedDoubleFn<Arg1, Arg2, Callback> {
	const result = Object.assign(
		function (input: z.input<Arg1>, input2: z.input<Arg2>): ReturnType<Callback> {
			const parsed = arg1.parse(input);
			const parsed2 = arg2.parse(input2);
			return cb(parsed, parsed2);
		},
		{ schemas: [arg1, arg2] as [Arg1, Arg2] }
	);

	return result;
}
