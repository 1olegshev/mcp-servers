# Slack MCP Server

A Model Context Protocol (MCP) server for Slack integration, designed for release management and QA coordination.

## Quick Reference

| What | Where |
|------|-------|
| Entry point | [src/server.ts](src/server.ts) |
| Auth | [src/auth/slack-auth.ts](src/auth/slack-auth.ts) |
| API client | [src/clients/slack-client.ts](src/clients/slack-client.ts) |
| Architecture docs | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) |
| Code snippets | [docs/QUICK_REFERENCE.md](docs/QUICK_REFERENCE.md) |

**Do not modify** without explicit request: `slack-auth.ts:validateWriteAccess()`, `TEST_BOT_IDS` in test-bot-config.ts.

## Features

- **Release Status Analysis**: Analyze testing channels to determine release readiness
- **Auto Test Monitoring**: Detect and analyze Cypress/Playwright results with thread review analysis
- **Blocking Issue Detection**: Identify critical/blocking issues with JIRA ticket extraction
- **Test Manager Updates**: Detect daily release decisions (release/hotfix/postpone)
- **LLM Classification**: Optional Ollama/Qwen3 integration for semantic blocker classification
- **Channel Communication**: Read from any channel, write only to `#qa-release-status`

## Authentication

### Token Types

| Token | Format | Source |
|-------|--------|--------|
| XOXC | `xoxc-...` | Browser DevTools → Network → Authorization header |
| XOXD | `xoxd-...` | Browser DevTools → Application → Cookies → `d` |

### How to Extract Tokens

1. Open Slack in browser, log in
2. DevTools (F12) → **Application** → **Cookies** → `https://app.slack.com`
3. Find `d` cookie → this is **XOXD**
4. **Network** tab → reload → find `api.slack.com` request
5. In headers, find `Authorization: Bearer xoxc-...` → this is **XOXC**

### Environment Setup

```bash
# In project root .env
SLACK_MCP_XOXC_TOKEN=xoxc-your-token-here
SLACK_MCP_XOXD_TOKEN=xoxd-your-token-here
```

### Security Notes

- Tokens are equivalent to your Slack password
- Tokens expire when you log out
- Actions appear as performed by the token owner
- **Write access restricted** to `#qa-release-status` only (hardcoded in `slack-auth.ts`)

## Available Tools

| Tool | Purpose | Safe |
|------|---------|------|
| `get_release_status_overview` | Comprehensive release readiness report | Read |
| `get_auto_test_status` | Auto test results (Cypress/Playwright) + thread review | Read |
| `get_blocking_issues` | Critical/blocking issue detection with JIRA extraction | Read |
| `get_test_manager_update` | Test manager's daily release decision | Read |
| `get_channel_history` | Read messages from any channel | Read |
| `get_thread_replies` | Read thread discussions | Read |
| `search_messages` | Search across workspace | Read |
| `list_channels` | List workspace channels | Read |
| `get_message_details` | Full message including blocks/attachments | Read |
| `find_bot_messages` | Debug bot message structure | Read |
| `send_message` | Post messages | Write (restricted) |

## Usage

### Installation

```bash
npm install
npm run build
```

### MCP Configuration

```json
{
  "slack": {
    "command": "node",
    "args": ["/path/to/mcp-servers/slack/dist/server.js"],
    "env": {
      "SLACK_MCP_XOXC_TOKEN": "xoxc-...",
      "SLACK_MCP_XOXD_TOKEN": "xoxd-..."
    }
  }
}
```

### CLI Testing

```bash
# Load env and test
export $(grep -v '^#' .env | grep -v '^$' | xargs)

# List tools
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | node dist/server.js 2>/dev/null | jq '.result.tools[].name'

# Get auto test status
echo '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_auto_test_status","arguments":{"date":"today"}}}' | node dist/server.js 2>/dev/null

# Get blocking issues
echo '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_blocking_issues","arguments":{}}}' | node dist/server.js 2>/dev/null
```

### Performance Tips

Use channel IDs for better performance:
```javascript
// Slow: requires API lookup
channel: "#qa-release-status"

// Fast: direct lookup
channel: "C09BW9Y2HSN"
```

## Troubleshooting

| Error | Fix |
|-------|-----|
| `invalid_auth` | Token expired, extract new XOXC/XOXD |
| `missing_scope` | User lacks permissions |
| `channel_not_found` | User doesn't have access to channel |
| `Write access restricted` | Can only post to #qa-release-status |
| `Cannot find module` | Run `npm run build` |

### VSCode MCP Caching

After rebuilding (`npm run build`), VSCode caches the old server. Restart VSCode (Cmd+Shift+P → "Reload Window") or test via CLI.

## Development

```bash
npm run build    # Compile TypeScript
npm run dev      # Development with watching
npm test         # Run tests
```

For architecture details, file structure, and modification guides, see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
