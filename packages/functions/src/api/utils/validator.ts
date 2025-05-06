import type { Hook } from "./hook";
import { z, ZodSchema } from "zod";
import { ErrorCodes } from "@nestri/core/error";
import { validator as zodValidator } from "hono-openapi/zod";
import type { MiddlewareHandler, ValidationTargets } from "hono";

type ZodIssueExtended = z.ZodIssue & {
    expected?: unknown;
    received?: unknown;
}

/**
 * Custom validator wrapper around hono-openapi/zod validator that formats errors
 */
export const validator = <
    T extends ZodSchema,
    Target extends keyof ValidationTargets
>(
    target: Target,
    schema: T
): MiddlewareHandler<
    Record<string, unknown>,
    string,
    {
        in: {
            [K in Target]: z.input<T>;
        };
        out: {
            [K in Target]: z.output<T>;
        };
    }
> => {
    const standardErrorHandler: Hook<z.infer<T>, any, any, Target> = (
        result,
        c,
    ) => {
        if (!result.success) {
            const issues = result.error.issues || result.error.errors || [];
            const firstIssue = issues[0];
            const fieldPath = Array.isArray(firstIssue?.path)
                ? firstIssue.path.join(".")
                : firstIssue?.path;

            let errorCode = ErrorCodes.Validation.INVALID_PARAMETER;
            if (firstIssue?.code === "invalid_type" && firstIssue?.received === "undefined") {
                errorCode = ErrorCodes.Validation.MISSING_REQUIRED_FIELD;
            } else if (
                ["invalid_string", "invalid_date", "invalid_regex"].includes(firstIssue?.code as string)
            ) {
                errorCode = ErrorCodes.Validation.INVALID_FORMAT;
            }

            const response = {
                type: "validation",
                code: errorCode,
                message: firstIssue?.message,
                param: fieldPath,
                details: issues.length > 1
                    ? {
                        issues: issues.map((issue: ZodIssueExtended) => ({
                            path: Array.isArray(issue.path) ? issue.path.join(".") : issue.path,
                            code: issue.code,
                            message: issue.message,
                            expected: issue.expected,
                            received: issue.received,
                        })),
                    }
                    : undefined,
            };

            console.log("Validation error in validator:", response);
            return c.json(response, 400);
        }
    };

    return zodValidator(target, schema, standardErrorHandler);
};
