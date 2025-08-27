/**
 * Base Handler for Common MCP Tool Operations
 */

import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';

export abstract class BaseHandler {
  
  /**
   * Validate required parameters
   */
  protected validateRequired(params: Record<string, any>, required: string[]): void {
    for (const param of required) {
      if (!params[param]) {
        throw new McpError(ErrorCode.InvalidParams, `${param} is required`);
      }
    }
  }

  /**
   * Handle errors consistently
   */
  protected handleError(error: any, operation: string): never {
    if (error instanceof McpError) {
      throw error;
    }
    
    throw new McpError(
      ErrorCode.InternalError,
      `Failed to ${operation}: ${error.data?.error || error.message}`
    );
  }

  /**
   * Format success response
   */
  protected formatResponse(text: string) {
    return {
      content: [{ type: 'text', text }]
    };
  }
}