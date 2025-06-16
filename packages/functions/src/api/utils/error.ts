import { resolver } from "hono-openapi/zod";
import { ErrorResponse } from "@nestri/core/error";

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