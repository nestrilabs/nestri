import { ZodError, ZodSchema, z } from 'zod';
import type { Env, ValidationTargets, Context, TypedResponse, Input, MiddlewareHandler } from 'hono';

type Hook<T, E extends Env, P extends string, Target extends keyof ValidationTargets = keyof ValidationTargets, O = {}> = (result: ({
    success: true;
    data: T;
} | {
    success: false;
    error: ZodError;
    data: T;
}) & {
    target: Target;
}, c: Context<E, P>) => Response | void | TypedResponse<O> | Promise<Response | void | TypedResponse<O>>;
type HasUndefined<T> = undefined extends T ? true : false;
declare const zValidator: <T extends ZodSchema<any, z.ZodTypeDef, any>, Target extends keyof ValidationTargets, E extends Env, P extends string, In = z.input<T>, Out = z.output<T>, I extends Input = {
    in: HasUndefined<In> extends true ? { [K in Target]?: (In extends ValidationTargets[K] ? In : { [K2 in keyof In]?: ValidationTargets[K][K2] | undefined; }) | undefined; } : { [K_1 in Target]: In extends ValidationTargets[K_1] ? In : { [K2_1 in keyof In]: ValidationTargets[K_1][K2_1]; }; };
    out: { [K_2 in Target]: Out; };
}, V extends I = I>(target: Target, schema: T, hook?: Hook<z.TypeOf<T>, E, P, Target, {}> | undefined) => MiddlewareHandler<E, P, V>;

export { type Hook, zValidator };