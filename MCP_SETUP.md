# MCP Configuration Setup

This document explains how to set up the Model Context Protocol (MCP) configuration for VS Code.

## Setup Instructions

1. **Copy the example configuration:**
   ```bash
   cp .vscode/mcp.json.example .vscode/mcp.json
   ```

2. **Update the paths:**
   - Replace `/path/to/your/MCP/` with your actual project path
   - Ensure all `cwd` paths point to the correct server directories

3. **Configure your credentials:**

### Jira & Confluence
- Replace `your-org.atlassian.net` with your Atlassian domain
- Replace `your-email@company.com` with your email
- Generate API tokens at: https://id.atlassian.com/manage-profile/security/api-tokens

### Slack (XOXC + XOXD Authentication)
1. **Open Slack in your browser** and log in to your workspace
2. **Open Developer Tools** (F12)
3. **Go to Application tab** → **Cookies** → Select your Slack domain
4. **Copy the required tokens:**
   - `XOXC`: Look for a cookie starting with `xoxc-`
   - `XOXD`: Copy the value of the `d` cookie (**use raw value, not URL-encoded**)

⚠️ **Important:** 
- XOXD token should be the raw value from the cookie, not URL-encoded
- These tokens expire periodically and need to be updated
- Never commit `mcp.json` with real tokens to version control

## Environment Variables Alternative

If you prefer using environment variables (for development), you can:

1. **Set environment variables in your shell:**
   ```bash
   export SLACK_MCP_XOXC_TOKEN="your-xoxc-token"
   export SLACK_MCP_XOXD_TOKEN="your-xoxd-token"
   # ... other variables
   ```

2. **Simplify mcp.json** by removing the `env` sections (servers will inherit from system environment)

## Security Notes

- The `mcp.json` file is gitignored to prevent accidental token exposure
- Always use the example file as a template
- Regularly rotate your API tokens
- Never share your tokens or commit them to version control

## Troubleshooting

### Slack Authentication Issues
- Ensure XOXD token is not URL-encoded
- Check that both XOXC and XOXD tokens are current
- Verify you're using tokens from the correct Slack workspace

### Path Issues
- Ensure all `cwd` paths in mcp.json point to existing directories
- Make sure the `dist/server.js` files exist (run `npm run build` in each server directory)

### VS Code Integration
- Restart VS Code after updating mcp.json
- Check VS Code's Developer Tools console for MCP-related errors