# VS Code Insiders MCP Configuration Setup

This guide will help you configure VS Code Insiders to use your MCP (Model Context Protocol) servers for Slack, Jira, and Confluence integration.

## Prerequisites

1. **VS Code Insiders** must be installed
2. **Node.js** and **npm** must be installed
3. **Environment variables** must be configured in `.env` file

## Setup Steps

### 1. Build MCP Servers

First, ensure all your MCP servers are built and ready:

```bash
# Build Jira MCP Server
cd /Users/olegshevchenko/Sourses/MCP/mcp-servers/jira
npm install
npm run build

# Build Confluence MCP Server  
cd /Users/olegshevchenko/Sourses/MCP/mcp-servers/confluence
npm install
npm run build

# Install Slack MCP Server dependencies
cd /Users/olegshevchenko/Sourses/MCP/mcp-servers/slack
npm install
```

### 2. Configure Environment Variables

Make sure your `.env` file at `/Users/olegshevchenko/Sourses/MCP/.env` contains:

```bash
# Slack Configuration
SLACK_BOT_TOKEN=xoxb-your-bot-token-here
SLACK_APP_TOKEN=xapp-your-app-token-here

# Jira Configuration
JIRA_BASE_URL=https://your-company.atlassian.net
JIRA_EMAIL=your-email@company.com
JIRA_API_TOKEN=your-jira-api-token-here

# Confluence Configuration
CONFLUENCE_BASE_URL=https://your-company.atlassian.net
CONFLUENCE_EMAIL=your-email@company.com
CONFLUENCE_API_TOKEN=your-confluence-api-token-here
```

### 3. VS Code Insiders MCP Configuration

The MCP configuration has been automatically updated at:
`~/Library/Application Support/Code - Insiders/User/mcp.json`

This configuration includes:
- **Slack MCP Server**: Direct Node.js execution
- **Jira MCP Server**: NPM start script with build
- **Confluence MCP Server**: NPM start script with build

### 4. Start VS Code Insiders with Environment Variables

**Option A: Use the provided script**
```bash
/Users/olegshevchenko/Sourses/MCP/start-vscode-insiders.sh
```

**Option B: Start manually with environment**
```bash
# Load environment variables and start VS Code Insiders
cd /Users/olegshevchenko/Sourses/MCP
export $(grep -v '^#' .env | xargs)
"/Applications/Visual Studio Code - Insiders.app/Contents/Resources/app/bin/code"
```

**Option C: Add to shell profile (permanent solution)**
Add this to your `~/.zshrc`:
```bash
alias code-insiders-mcp='cd /Users/olegshevchenko/Sourses/MCP && export $(grep -v "^#" .env | xargs) && "/Applications/Visual Studio Code - Insiders.app/Contents/Resources/app/bin/code"'
```

### 5. Verify Setup

1. Start VS Code Insiders using one of the methods above
2. Open the Command Palette (`Cmd+Shift+P`)
3. Look for MCP-related commands or check the status bar for MCP server indicators
4. The MCP servers should automatically start when VS Code Insiders loads

## Troubleshooting

### Common Issues

1. **Environment Variables Not Loading**
   - Ensure you start VS Code Insiders with the environment loaded
   - Check that your `.env` file exists and contains the correct values

2. **TypeScript Build Errors**
   - Run `npm run build` in each TypeScript server directory
   - Check for any compilation errors

3. **Permission Issues**
   - Ensure the startup script is executable: `chmod +x start-vscode-insiders.sh`

4. **Path Issues**
   - Verify all paths in the MCP configuration are absolute paths
   - Check that all server files exist at the specified locations

### Testing Individual Servers

You can test each server individually:

```bash
# Test Slack server
cd /Users/olegshevchenko/Sourses/MCP/mcp-servers/slack
node server.js

# Test Jira server
cd /Users/olegshevchenko/Sourses/MCP/mcp-servers/jira  
npm run start

# Test Confluence server
cd /Users/olegshevchenko/Sourses/MCP/mcp-servers/confluence
npm run start
```

## Configuration Files

- **VS Code Insiders MCP Config**: `~/Library/Application Support/Code - Insiders/User/mcp.json`
- **Project MCP Config**: `/Users/olegshevchenko/Sourses/MCP/mcp_config.json`
- **Environment Variables**: `/Users/olegshevchenko/Sourses/MCP/.env`
- **Startup Script**: `/Users/olegshevchenko/Sourses/MCP/start-vscode-insiders.sh`

## Next Steps

1. Start VS Code Insiders using the provided script
2. Test MCP functionality with your Slack, Jira, and Confluence integrations
3. Check VS Code Insiders documentation for any MCP-specific features or commands