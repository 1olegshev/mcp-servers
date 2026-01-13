# MCP Configuration Setup

This document explains how to set up the Model Context Protocol (MCP) configuration for VS Code.

## Architecture: How Credentials Work

**All MCP servers load credentials from the `.env` file automatically** via the shared `loadEnv()` utility. You do NOT need to (and should NOT) put credentials in `mcp.json`.

```
.env (credentials) ─────► loadEnv() ─────► Server reads process.env
                              ▲
                              │
               Servers call loadEnv(import.meta.url) on startup
```

## Setup Instructions

### 1. Copy the configuration files

```bash
# Copy VS Code MCP config (no credentials needed here)
cp .vscode/mcp.json.example .vscode/mcp.json

# Copy environment variables template
cp env.example .env
```

### 2. Update paths in mcp.json

Replace `/path/to/your/MCP/` with your actual project path in `.vscode/mcp.json`.

### 3. Configure credentials in .env

Edit the `.env` file with your actual credentials:

#### Jira & Confluence
```bash
JIRA_BASE_URL=https://your-org.atlassian.net
JIRA_EMAIL=your-email@company.com
JIRA_API_TOKEN=your-api-token-here

CONFLUENCE_BASE_URL=https://your-org.atlassian.net
CONFLUENCE_EMAIL=your-email@company.com
CONFLUENCE_API_TOKEN=your-api-token-here
```

Generate API tokens at: https://id.atlassian.com/manage-profile/security/api-tokens

#### Slack (XOXC + XOXD Authentication)
```bash
SLACK_MCP_XOXC_TOKEN=xoxc-your-session-token
SLACK_MCP_XOXD_TOKEN=xoxd-your-cookie-data
```

**Quick extraction:**
1. Open Slack in your browser and log in
2. Open Developer Tools (F12) → **Application** tab → **Cookies** → `https://app.slack.com`
3. Find the `d` cookie → this is your **XOXD** token (starts with `xoxd-`)
4. Go to **Network** tab → reload page → find any `api.slack.com` request
5. In request headers, find `Authorization: Bearer xoxc-...` → this is your **XOXC** token

For detailed instructions, see [mcp-servers/slack/README.md](mcp-servers/slack/README.md#how-to-extract-tokens)

### 4. Build and restart

```bash
npm run build
# Then restart VS Code
```

## Security Notes

> **CRITICAL: Never put credentials in `mcp.json`**
>
> VS Code's MCP extension does NOT support `${env:VAR}` syntax. If you put credentials
> in `mcp.json`, they will be stored as plaintext. Always use `.env` instead.

- The `.env` file is gitignored to prevent accidental token exposure
- The `mcp.json` file is also gitignored, but should contain NO credentials
- Regularly rotate your API tokens
- Never share your tokens or commit them to version control
- See [mcp-servers/slack/SECURITY.md](mcp-servers/slack/SECURITY.md) for detailed security guidance

## Troubleshooting

### Servers not finding credentials
- Ensure `.env` file exists in the project root
- Check that variable names match exactly (e.g., `JIRA_API_TOKEN` not `JIRA_TOKEN`)
- Restart VS Code after creating/modifying `.env`

### Slack Authentication Issues
- Ensure XOXD token is not URL-encoded (use raw value)
- Check that both XOXC and XOXD tokens are current
- Verify you're using tokens from the correct Slack workspace
- Tokens expire periodically - refresh from browser if auth fails

### Path Issues
- Ensure all `cwd` paths in mcp.json point to existing directories
- Make sure the `dist/server.js` files exist (run `npm run build`)

### VS Code Integration
- Restart VS Code after updating mcp.json or .env
- Check VS Code's Developer Tools console for MCP-related errors
