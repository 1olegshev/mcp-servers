/**
 * @mcp-servers/shared
 * Shared utilities and types for MCP servers
 */

// Environment utilities
export {
  loadEnv,
  loadEnvManually,
  getDirname,
  findProjectRoot,
  getEnv,
  getEnvOrThrow,
  type EnvLoaderOptions,
} from './env-loader.js';

// Types
export {
  // Config types
  type AtlassianApiConfig,
  type JiraConfig,
  type ConfluenceConfig,
  type SlackConfig,
  // MCP types
  type MCPTextContent,
  type MCPResponse,
  type MCPTool,
  type MCPToolCall,
  type MCPToolsListResponse,
  // Response helpers
  createTextResponse,
  createSuccessResponse,
  createErrorResponse,
  // Utility types
  type PaginatedResult,
  type ApiUser,
} from './types.js';

// Error handling
export {
  MCPServerError,
  ValidationError,
  ApiError,
  AuthenticationError,
  ConfigurationError,
  MethodNotFoundError,
  withErrorHandling,
  getErrorMessage,
  extractApiErrorDetails,
  createApiError,
} from './errors.js';
