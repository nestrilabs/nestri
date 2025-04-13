import { z, ZodSchema } from "zod";
import {type Hook } from "./types/hook";
import { ErrorCodes, ErrorResponse } from "@nestri/core/error";
import type { MiddlewareHandler, ValidationTargets } from "hono";
import { resolver, validator as zodValidator } from "hono-openapi/zod";

export function Result<T extends z.ZodTypeAny>(schema: T) {
  return resolver(
    z.object({
      data: schema,
    }),
  );
}

/**
 * Custom validator wrapper around hono-openapi/zod validator that formats errors
 * according to our standard API error format
 */
export const validator = <
  T extends ZodSchema,
  Target extends keyof ValidationTargets
>(
  target: Target,
  schema: T
): MiddlewareHandler<
  any,
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
  // Create a custom error handler that formats errors according to our standards
  // const standardErrorHandler: Parameters<typeof zodValidator>[2] = (
  const standardErrorHandler: Hook<z.infer<T>, any, any, Target> = (
    result,
    c,
  ) => {
    if (!result.success) {
      // Get the validation issues
      const issues = result.error.issues || result.error.errors || [];
      if (issues.length === 0) {
        // If there are no issues, return a generic error
        return c.json(
          {
            type: "validation",
            code: ErrorCodes.Validation.INVALID_PARAMETER,
            message: "Invalid request data",
          },
          400,
        );
      }

      // Get the first error for the main response
      const firstIssue = issues[0]!;
      const fieldPath = firstIssue.path
        ? Array.isArray(firstIssue.path)
          ? firstIssue.path.join(".")
          : firstIssue.path
        : undefined;

      // Map Zod error codes to our standard error codes
      let errorCode = ErrorCodes.Validation.INVALID_PARAMETER;
      if (
        firstIssue.code === "invalid_type" &&
        firstIssue.received === "undefined"
      ) {
        errorCode = ErrorCodes.Validation.MISSING_REQUIRED_FIELD;
      } else if (
        ["invalid_string", "invalid_date", "invalid_regex"].includes(
          firstIssue.code,
        )
      ) {
        errorCode = ErrorCodes.Validation.INVALID_FORMAT;
      }

      // Create our standardized error response
      const response = {
        type: "validation",
        code: errorCode,
        message: firstIssue.message,
        param: fieldPath,
        details: undefined as any,
      };

      // Add details if we have multiple issues
      if (issues.length > 0) {
        response.details = {
          issues: issues.map((issue) => ({
            path: issue.path
              ? Array.isArray(issue.path)
                ? issue.path.join(".")
                : issue.path
              : undefined,
            code: issue.code,
            message: issue.message,
            // @ts-expect-error
            expected: issue.expected,
            // @ts-expect-error
            received: issue.received,
          })),
        };
      }

      console.log("Validation error in validator:", response);
      return c.json(response, 400);
    }
  };

  // Use the original validator with our custom error handler
  return zodValidator(target, schema, standardErrorHandler);
};

/**
 * Standard error responses for OpenAPI documentation
 */
export const ErrorResponses = {
  400: {
    content: {
      "application/json": {
        schema: resolver(
          ErrorResponse.openapi({
            description: "Validation error",
            example: {
              type: "validation",
              code: "invalid_parameter",
              message: "The request was invalid",
              param: "email",
            },
          }),
        ),
      },
    },
    description:
      "Bad Request - The request could not be understood or was missing required parameters.",
  },
  401: {
    content: {
      "application/json": {
        schema: resolver(
          ErrorResponse.openapi({
            description: "Authentication error",
            example: {
              type: "authentication",
              code: "unauthorized",
              message: "Authentication required",
            },
          }),
        ),
      },
    },
    description:
      "Unauthorized - Authentication is required and has failed or has not been provided.",
  },
  403: {
    content: {
      "application/json": {
        schema: resolver(
          ErrorResponse.openapi({
            description: "Permission error",
            example: {
              type: "forbidden",
              code: "permission_denied",
              message: "You do not have permission to access this resource",
            },
          }),
        ),
      },
    },
    description:
      "Forbidden - You do not have permission to access this resource.",
  },
  404: {
    content: {
      "application/json": {
        schema: resolver(
          ErrorResponse.openapi({
            description: "Not found error",
            example: {
              type: "not_found",
              code: "resource_not_found",
              message: "The requested resource could not be found",
            },
          }),
        ),
      },
    },
    description: "Not Found - The requested resource does not exist.",
  },
  409: {
    content: {
      "application/json": {
        schema: resolver(
          ErrorResponse.openapi({
            description: "Conflict Error",
            example: {
              type: "already_exists",
              code: "resource_already_exists",
              message: "The resource could not be created because it already exists",
            },
          }),
        ),
      },
    },
    description: "Conflict - The resource could not be created because it already exists.",
  },
  429: {
    content: {
      "application/json": {
        schema: resolver(
          ErrorResponse.openapi({
            description: "Rate limit error",
            example: {
              type: "rate_limit",
              code: "too_many_requests",
              message: "Rate limit exceeded",
            },
          }),
        ),
      },
    },
    description:
      "Too Many Requests - You have made too many requests in a short period of time.",
  },
  500: {
    content: {
      "application/json": {
        schema: resolver(
          ErrorResponse.openapi({
            description: "Server error",
            example: {
              type: "internal",
              code: "internal_error",
              message: "Internal server error",
            },
          }),
        ),
      },
    },
    description: "Internal Server Error - Something went wrong on our end.",
  },
};