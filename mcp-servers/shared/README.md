# @mcp-servers/shared

Shared utilities and types for MCP (Model Context Protocol) servers.

## Installation

This package is part of the MCP servers monorepo and is automatically available to all workspace packages.

```bash
# From the root of the monorepo:
npm install
```

## Usage

### Environment Loading

```typescript
import { loadEnv, getEnv, getEnvOrThrow } from '@mcp-servers/shared';

// Load .env file (automatically finds project root)
loadEnv(import.meta.url);

// Get environment variable with default
const channel = getEnv('DEFAULT_CHANNEL', 'general');

// Get required environment variable (throws if not set)
const apiToken = getEnvOrThrow('API_TOKEN');
```

### Error Handling

```typescript
import {
  MCPServerError,
  ValidationError,
  ApiError,
  withErrorHandling,
  getErrorMessage
} from '@mcp-servers/shared';

// Create typed errors
throw new ValidationError('Invalid input');
throw new ApiError('API call failed', 500, responseData);

// Wrap async handlers with error handling
const result = await withErrorHandling(async () => {
  // Your async operation
  return await someApiCall();
});

// Extract error messages safely
const message = getErrorMessage(unknownError);
```

### Types

```typescript
import {
  MCPResponse,
  MCPTool,
  AtlassianApiConfig,
  createTextResponse,
  createSuccessResponse,
  createErrorResponse
} from '@mcp-servers/shared';

// Create standard MCP responses
const response = createTextResponse('Hello, world!');
const success = createSuccessResponse('Operation completed', 'Details here');
const error = createErrorResponse('Something went wrong');

// Type your API configs
const config: AtlassianApiConfig = {
  baseUrl: 'https://example.atlassian.net',
  email: 'user@example.com',
  apiToken: 'your-token'
};
```

## API Reference

### Environment Functions

| Function | Description |
|----------|-------------|
| `loadEnv(importMetaUrl, options?)` | Load .env file from project root |
| `loadEnvManually(envPath)` | Load .env file without dotenv (manual parsing) |
| `getEnv(name, defaultValue?)` | Get optional env variable with default |
| `getEnvOrThrow(name, defaultValue?)` | Get required env variable |
| `getDirname(importMetaUrl)` | Get __dirname equivalent in ESM |
| `findProjectRoot(startDir)` | Find project root by looking for .env or package.json |

### Error Classes

| Class | Use Case |
|-------|----------|
| `MCPServerError` | Base error class for all MCP server errors |
| `ValidationError` | Input validation failures |
| `ApiError` | API communication failures |
| `AuthenticationError` | Authentication failures |
| `ConfigurationError` | Configuration issues |
| `MethodNotFoundError` | Unknown method/tool errors |

### Types

| Type | Description |
|------|-------------|
| `MCPResponse` | Standard MCP response structure |
| `MCPTool` | MCP tool definition |
| `MCPToolCall` | MCP tool call structure |
| `AtlassianApiConfig` | Base config for Jira/Confluence |
| `JiraConfig` | Jira-specific config |
| `ConfluenceConfig` | Confluence-specific config |
| `SlackConfig` | Slack-specific config |

## Development

```bash
# Build the package
npm run build

# Clean build output
npm run clean
```
