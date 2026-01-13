# Agent Guide: Using MCP Tools from CLI

This guide helps AI agents (Claude, etc.) quickly test and use MCP tools without going through the VS Code integration.

## Quick Start

### 1. Load Environment Variables

The `.env` file is at the project root (`/Users/olegshevchenko/Sourses/MCP/.env`). Load it:

```bash
cd /Users/olegshevchenko/Sourses/MCP
export $(grep -v '^#' .env | grep -v '^$' | xargs)
```

### 2. Build the Server (if needed)

```bash
cd mcp-servers/slack && npm run build
```

### 3. Call MCP Tools

Use JSON-RPC piped to stdin:

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"TOOL_NAME","arguments":{...}}}' | node mcp-servers/slack/dist/server.js
```

## Common Patterns

### List Available Tools

```bash
export $(grep -v '^#' .env | grep -v '^$' | xargs)
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | node mcp-servers/slack/dist/server.js 2>/dev/null | jq '.result.tools[].name'
```

### Slack MCP Tools

**Get auto test status** (read-only, safe to run):
```bash
export $(grep -v '^#' .env | grep -v '^$' | xargs)
echo '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_auto_test_status","arguments":{"date":"today"}}}' | node mcp-servers/slack/dist/server.js 2>/dev/null
```

**Get blocking issues** (read-only):
```bash
echo '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_blocking_issues","arguments":{}}}' | node mcp-servers/slack/dist/server.js 2>/dev/null
```

**Get release status overview** (read-only):
```bash
echo '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_release_status_overview","arguments":{}}}' | node mcp-servers/slack/dist/server.js 2>/dev/null
```

**Get channel history**:
```bash
echo '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_channel_history","arguments":{"channel":"functional-testing","limit":5}}}' | node mcp-servers/slack/dist/server.js 2>/dev/null
```

### Jira MCP Tools

```bash
export $(grep -v '^#' .env | grep -v '^$' | xargs)
echo '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_testing_summary","arguments":{}}}' | node mcp-servers/jira/dist/server.js 2>/dev/null
```

### Release Coordinator

```bash
export $(grep -v '^#' .env | grep -v '^$' | xargs)
echo '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_comprehensive_release_overview","arguments":{}}}' | node mcp-servers/release-coordinator/dist/server.js 2>/dev/null
```

## Important Notes

### DO NOT Run Production Scripts for Testing

- `scripts/release-status-auto.mjs` - POSTS to Slack (side effects!)
- Use the MCP tools directly instead (read-only by default)

### Slack Tool Safety

| Tool | Safe to Run | Notes |
|------|-------------|-------|
| `get_auto_test_status` | Yes | Read-only |
| `get_blocking_issues` | Yes | Read-only |
| `get_release_status_overview` | Yes | Read-only |
| `get_channel_history` | Yes | Read-only |
| `search_messages` | Yes | Read-only |
| `send_message` | CAUTION | Posts to Slack (restricted to qa-release-status) |

### Converting Slack Timestamps to Dates

Slack message URLs contain timestamps. To convert:

```bash
# Extract from URL like p1768296887355659
# Timestamp is 1768296887.355659 (first 10 digits are unix seconds)
date -r 1768296887 '+%Y-%m-%d %H:%M'
```

## Debugging Tips

### Check if Server is Working

```bash
export $(grep -v '^#' .env | grep -v '^$' | xargs)
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | node mcp-servers/slack/dist/server.js 2>/dev/null | jq '.result.tools | length'
# Should return number of available tools (e.g., 11)
```

### Common Errors

| Error | Cause | Fix |
|-------|-------|-----|
| `Missing Slack authentication` | Env vars not loaded | Run the `export $(grep...)` command first |
| `Cannot find module` | Not built | Run `npm run build` in the server directory |
| `ENOENT dist/server.js` | Wrong directory | `cd` to project root first |

## Server Locations

| Server | Path | Main Tools |
|--------|------|------------|
| Slack | `mcp-servers/slack/dist/server.js` | Test status, blocking issues, channel history |
| Jira | `mcp-servers/jira/dist/server.js` | Testing summary, ticket search |
| Confluence | `mcp-servers/confluence/dist/server.js` | Page content, search |
| Release Coordinator | `mcp-servers/release-coordinator/dist/server.js` | Unified release overview |

## One-Liner Examples

```bash
# Full auto test check (from project root)
cd /Users/olegshevchenko/Sourses/MCP && export $(grep -v '^#' .env | grep -v '^$' | xargs) && echo '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_auto_test_status","arguments":{}}}' | node mcp-servers/slack/dist/server.js 2>/dev/null | jq -r '.result.content[0].text'

# Full release status (from project root)
cd /Users/olegshevchenko/Sourses/MCP && export $(grep -v '^#' .env | grep -v '^$' | xargs) && echo '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_comprehensive_release_overview","arguments":{}}}' | node mcp-servers/release-coordinator/dist/server.js 2>/dev/null | jq -r '.result.content[0].text'
```
