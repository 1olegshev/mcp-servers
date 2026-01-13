/**
 * Shared type definitions for MCP servers
 * Contains common interfaces used across multiple servers
 */

// ============================================
// API Configuration Types
// ============================================

/**
 * Base configuration for Atlassian APIs (Jira, Confluence)
 */
export interface AtlassianApiConfig {
  baseUrl: string;
  email: string;
  apiToken: string;
}

/**
 * Jira-specific API configuration
 */
export interface JiraConfig extends AtlassianApiConfig {}

/**
 * Confluence-specific API configuration
 */
export interface ConfluenceConfig extends AtlassianApiConfig {}

/**
 * Slack API configuration
 */
export interface SlackConfig {
  /** Bot token (xoxb-...) */
  botToken?: string;
  /** User token for XOXC auth */
  userToken?: string;
  /** Cookie for XOXD auth */
  cookie?: string;
}

// ============================================
// MCP Response Types
// ============================================

/**
 * Standard MCP text content item
 */
export interface MCPTextContent {
  type: 'text';
  text: string;
}

/**
 * Standard MCP response structure
 */
export interface MCPResponse {
  content: MCPTextContent[];
}

/**
 * MCP tool definition structure
 */
export interface MCPTool {
  name: string;
  description: string;
  inputSchema: {
    type: string;
    properties: Record<string, unknown>;
    required?: string[];
  };
}

/**
 * MCP tool call structure
 */
export interface MCPToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

/**
 * MCP tools list response
 */
export interface MCPToolsListResponse {
  tools: MCPTool[];
}

// ============================================
// Common Response Formatting Utilities
// ============================================

/**
 * Create a standard MCP text response
 */
export function createTextResponse(text: string): MCPResponse {
  return {
    content: [{ type: 'text', text }]
  };
}

/**
 * Create a success response with optional content
 */
export function createSuccessResponse(message: string, content?: string): MCPResponse {
  const text = content ? `${message}:\n\n${content}` : message;
  return createTextResponse(text);
}

/**
 * Create an error response
 */
export function createErrorResponse(message: string): MCPResponse {
  return createTextResponse(`Error: ${message}`);
}

// ============================================
// Generic Utility Types
// ============================================

/**
 * Generic paginated result structure
 */
export interface PaginatedResult<T> {
  items: T[];
  total: number;
  maxResults: number;
  startAt: number;
}

/**
 * Generic API user structure
 */
export interface ApiUser {
  displayName: string;
  emailAddress?: string;
  accountId?: string;
}
