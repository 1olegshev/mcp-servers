/**
 * Shared error handling utilities for MCP servers
 * Provides consistent error handling patterns across all servers
 */

import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';

/**
 * Base error class for MCP server operations
 */
export class MCPServerError extends Error {
  constructor(
    message: string,
    public readonly code: string = 'INTERNAL_ERROR',
    public readonly cause?: Error
  ) {
    super(message);
    this.name = 'MCPServerError';
  }

  /**
   * Convert to MCP SDK error format
   */
  toMcpError(): McpError {
    return new McpError(ErrorCode.InternalError, this.message);
  }
}

/**
 * Error for validation failures
 */
export class ValidationError extends MCPServerError {
  constructor(message: string, cause?: Error) {
    super(message, 'VALIDATION_ERROR', cause);
    this.name = 'ValidationError';
  }

  toMcpError(): McpError {
    return new McpError(ErrorCode.InvalidParams, this.message);
  }
}

/**
 * Error for API communication failures
 */
export class ApiError extends MCPServerError {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly responseData?: unknown,
    cause?: Error
  ) {
    super(message, 'API_ERROR', cause);
    this.name = 'ApiError';
  }
}

/**
 * Error for authentication failures
 */
export class AuthenticationError extends MCPServerError {
  constructor(message: string, cause?: Error) {
    super(message, 'AUTH_ERROR', cause);
    this.name = 'AuthenticationError';
  }
}

/**
 * Error for configuration issues
 */
export class ConfigurationError extends MCPServerError {
  constructor(message: string, cause?: Error) {
    super(message, 'CONFIG_ERROR', cause);
    this.name = 'ConfigurationError';
  }
}

/**
 * Error for method not found
 */
export class MethodNotFoundError extends MCPServerError {
  constructor(methodName: string) {
    super(`Unknown method: ${methodName}`, 'METHOD_NOT_FOUND');
    this.name = 'MethodNotFoundError';
  }

  toMcpError(): McpError {
    return new McpError(ErrorCode.MethodNotFound, this.message);
  }
}

// ============================================
// Error Handling Utilities
// ============================================

/**
 * Wrap an async handler with error handling
 * Catches errors and converts them to appropriate MCP responses
 */
export async function withErrorHandling<T>(
  fn: () => Promise<T>,
  errorHandler?: (error: Error) => T
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof McpError) {
      throw error;
    }

    if (errorHandler) {
      return errorHandler(error instanceof Error ? error : new Error(String(error)));
    }

    if (error instanceof MCPServerError) {
      throw error.toMcpError();
    }

    const message = error instanceof Error ? error.message : String(error);
    throw new McpError(ErrorCode.InternalError, `Error: ${message}`);
  }
}

/**
 * Extract error message from various error types
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message: unknown }).message);
  }
  return String(error);
}

/**
 * Extract API error details from axios-like error responses
 */
export function extractApiErrorDetails(error: unknown): {
  message: string;
  statusCode?: number;
  data?: unknown;
} {
  const baseMessage = getErrorMessage(error);

  // Check for axios-style error
  if (error && typeof error === 'object') {
    const axiosError = error as {
      response?: {
        status?: number;
        data?: { message?: string; errorMessages?: string[] };
      };
    };

    if (axiosError.response) {
      const status = axiosError.response.status;
      const data = axiosError.response.data;
      const apiMessage =
        data?.message ||
        data?.errorMessages?.join(', ') ||
        baseMessage;

      return {
        message: apiMessage,
        statusCode: status,
        data: data,
      };
    }
  }

  return { message: baseMessage };
}

/**
 * Create an API error from an axios-like error
 */
export function createApiError(error: unknown, context: string): ApiError {
  const details = extractApiErrorDetails(error);
  return new ApiError(
    `${context}: ${details.message}`,
    details.statusCode,
    details.data,
    error instanceof Error ? error : undefined
  );
}
