# Slack MCP Server

A Model Context Protocol (MCP) server for interacting with Slack workspaces, designed specifically for release management and QA coordination workflows.

## Features

- **Release Status Analysis**: Comprehensive analysis of functional testing channels to determine release readiness
- **Channel Communication**: Read from any channel, write only to authorized release channels
- **Auto Test Monitoring**: Detection and analysis of automated test results
- **Blocking Issue Detection**: Identification of critical and blocking issues
- **Secure Channel Access**: Restricted write permissions for controlled release communication

## Authentication

### Overview

This server uses **XOXC/XOXD session-based authentication** instead of traditional bot tokens. This approach provides:

- **Real user session access** with full workspace permissions
- **No bot installation required** 
- **Access to private channels** and DMs
- **Simplified setup** for internal tools

### Authentication Method Details

#### XOXC Token (Session Cookie)
- **Purpose**: Primary authentication token representing an active user session
- **Format**: `xoxc-...` followed by a long alphanumeric string
- **Source**: Extracted from browser cookies when logged into Slack web
- **Security**: Acts as your personal session - treat as password

#### XOXD Token (Session Secret)
- **Purpose**: Secondary authentication parameter that pairs with XOXC
- **Format**: `xoxd-...` followed by a numeric string
- **Source**: Found in browser developer tools during Slack web requests
- **Security**: Required together with XOXC for complete authentication

### How to Extract Tokens

1. **Open Slack in your browser** and log in to your workspace
2. **Open Developer Tools** (F12 or right-click → Inspect)
3. **Go to Application tab** → Cookies → `https://app.slack.com`
4. **Find the `d` cookie** - this is your XOXD token (format: `xoxd-...`)
5. **Go to Network tab** and reload the page
6. **Look for any API request** to `api.slack.com`
7. **In the request headers**, find `Authorization: Bearer xoxc-...` - this is your XOXC token

### Environment Setup

Create a `.env` file in the project root:

```env
SLACK_XOXC_TOKEN=xoxc-your-token-here
SLACK_XOXD_TOKEN=xoxd-your-token-here
```

### Authentication Implementation

The server uses a simplified authentication approach in `simple-xoxc.ts`:

```typescript
export function createXOXCWebClient(xoxcToken: string, xoxdToken: string): WebClient {
  return new WebClient(xoxcToken, {
    headers: {
      Cookie: `d=${xoxdToken};`,
    },
  });
}
```

### Security Considerations

#### ⚠️ Important Security Notes

1. **Token Sensitivity**: XOXC/XOXD tokens are equivalent to your Slack password
2. **Session Expiration**: Tokens expire when you log out or session times out
3. **Personal Access**: Tokens grant access to everything you can see in Slack
4. **No Audit Trail**: Actions appear as if performed by the token owner
5. **Workspace Specific**: Tokens only work for the workspace they were extracted from

#### Best Practices

- **Rotate tokens regularly** (extract new ones periodically)
- **Use dedicated service accounts** when possible
- **Store tokens securely** (never commit to version control)
- **Monitor token usage** through Slack audit logs
- **Limit server access** to trusted systems only

#### Channel Write Restrictions

For security and process control, the server implements **strict write permissions**:

```typescript
// BUSINESS REQUIREMENT: Only allow posting to qa-release-status channel
const allowedChannels = ['qa-release-status', '#qa-release-status', 'C09BW9Y2HSN'];
```

**Why this restriction exists:**
- Prevents accidental posts to wrong channels
- Ensures release communication follows proper channels
- Maintains audit trail for release decisions
- Reduces risk of sensitive information leakage

## Usage

### Installation

```bash
npm install
npm run build
```

### Available Tools

1. **get_release_status_overview** - Comprehensive release readiness analysis
2. **get_auto_test_status** - Auto test results and review status
3. **get_blocking_issues** - Critical/blocking issue detection
4. **get_channel_history** - Read messages from any channel
5. **send_message** - Post messages (restricted to qa-release-status only)
6. **list_channels** - List workspace channels
7. **search_messages** - Search across workspace
8. **add_reaction** - Add emoji reactions
9. **get_thread_replies** - Read thread discussions

### MCP Configuration

Add to your MCP settings (e.g., Claude Desktop):

```json
{
  "slack-release": {
    "command": "node",
    "args": ["/path/to/slack-mcp-server/dist/server.js"],
    "env": {
      "SLACK_XOXC_TOKEN": "xoxc-your-token",
      "SLACK_XOXD_TOKEN": "xoxd-your-token"
    }
  }
}
```

## Release Management Workflow

### Daily Release Check

1. **Analyze functional testing**: Check latest messages for test results
2. **Review auto tests**: Verify all automated tests have passed
3. **Scan for blockers**: Look for critical or blocking issues
4. **Generate status**: Create comprehensive release readiness report
5. **Post to qa-release-status**: Share decision with team

### Example Usage

```bash
# Get release status
echo '{"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": "get_release_status_overview", "arguments": {"channel": "functional-testing"}}}' | node dist/server.js

# Post status (only to qa-release-status)
echo '{"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": "send_message", "arguments": {"channel": "qa-release-status", "text": "🟢 Release approved - all tests passing"}}}' | node dist/server.js
```

## Troubleshooting

### Authentication Issues

- **"invalid_auth" error**: Token expired, extract new XOXC/XOXD
- **"missing_scope" error**: User lacks permissions for requested action
- **Network errors**: Check if Slack is accessible

### Token Extraction Problems

- **Can't find d cookie**: Clear browser cache and try again
- **XOXC not in headers**: Make sure you're logged in and making API requests
- **Tokens don't work**: Verify workspace and token format

### Channel Access Issues

- **"channel_not_found"**: User doesn't have access to channel
- **"Write access restricted"**: Trying to post to unauthorized channel
- **"is_archived"**: Channel has been archived

## Development

### Project Structure

```
src/
├── server.ts           # Main MCP server implementation
├── simple-xoxc.ts     # Authentication helper
└── types.ts           # TypeScript type definitions
```

### Building

```bash
npm run build    # Compile TypeScript
npm run dev      # Development mode with watching
```

### Testing

```bash
# Test authentication
node dist/server.js <<< '{"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": "list_channels", "arguments": {}}}'

# Test release analysis
node dist/server.js <<< '{"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": "get_release_status_overview", "arguments": {"channel": "functional-testing"}}}'
```

## License

Internal use only - Not for public distribution