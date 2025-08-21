# MCP Servers Setup

This repository contains MCP (Model Context Protocol) server implementations for Slack, Jira, and Confluence integration. These servers allow you to interact with these services through chat interfaces that support the MCP protocol.

## 🚀 Quick Start

### Prerequisites

- Node.js 16+
- npm
- API access tokens for Slack, Jira, and Confluence

### Installation

1. **Clone and setup:**
   ```bash
   git clone <your-repo>
   cd mcp-servers
   ./setup.sh
   ```

2. **Configure environment variables:**
   ```bash
   cp env.example .env
   # Edit .env with your actual credentials
   ```

3. **Test your setup:**
   ```bash
   ./test-servers.sh
   ```

## 🔧 Configuration

### Slack Setup

1. Go to [https://api.slack.com/apps](https://api.slack.com/apps)
2. Create a new app or use existing one
3. Enable Bot Users and generate tokens:
   - `SLACK_BOT_TOKEN`: Bot User OAuth Token (xoxb-...)
   - `SLACK_APP_TOKEN`: App-Level Token (xapp-...)

### Jira Setup

1. Go to [https://id.atlassian.com/manage-profile/security/api-tokens](https://id.atlassian.com/manage-profile/security/api-tokens)
2. Create API token
3. Set environment variables:
   - `JIRA_BASE_URL`: Your Jira instance URL
   - `JIRA_EMAIL`: Your Jira account email
   - `JIRA_API_TOKEN`: Your API token

### Confluence Setup

1. Use the same API token as Jira (if same Atlassian instance)
2. Set environment variables:
   - `CONFLUENCE_BASE_URL`: Your Confluence instance URL
   - `CONFLUENCE_EMAIL`: Your Confluence account email
   - `CONFLUENCE_API_TOKEN`: Your API token

## 🎯 Usage

### Starting Individual Servers

```bash
# Slack server
npm run start:slack

# Jira server
npm run start:jira

# Confluence server
npm run start:confluence

# All servers simultaneously
npm run dev
```

### Available Tools

#### Slack MCP Server

- **send_message**: Send messages to channels
- **list_channels**: List workspace channels
- **get_channel_history**: Get recent messages
- **search_messages**: Search workspace messages

#### Jira MCP Server

- **search_issues**: Search issues with JQL (with smart NoTest filtering)
- **get_testing_board_issues**: Get issues from specific testing board
- **get_issue_details**: Get detailed issue information  
- **get_boards**: List all available Jira boards
- **update_issue_labels**: Update issue labels
- **update_issue_components**: Update issue components

**🔍 Smart NoTest Filtering:**
By default, all searches exclude tickets with NoTest labels (`NoTest`, `no-test`, `notest`, `noTest`, `Notest`) to match your testing board behavior. Use `includeNoTest: true` parameter to include them.

**Example Queries:**
- *"Show me tickets ready for testing from SkynetTeam"* → `status = "In QA" AND labels = "SkynetTeam"`
- *"Do we have test approved backend bugs?"* → `project = BACK AND issuetype = Bug AND status = "Test Passed"`

#### Confluence MCP Server

- **search_content**: Search for pages and content
- **get_page**: Get page content
- **get_spaces**: List accessible spaces
- **get_pages_in_space**: Get pages in a space
- **create_page**: Create new pages
- **update_page**: Update existing pages
- **read_article**: Read and analyze articles with metadata
- **edit_section**: Edit specific sections of a page
- **create_child_page**: Create child pages under specific parents
- **find_page_by_title**: Find pages by title within spaces
- **get_page_structure**: Get hierarchical page structure

## 🔌 MCP Client Integration

Configure your MCP client to connect to these servers using the stdio transport. Each server runs independently and communicates via standard input/output.

### Chat Mode Usage Examples

#### Confluence Integration

**Reading Articles:**
- "Read the article about project requirements" → Uses `find_page_by_title` then `read_article`
- "Show me the documentation for API endpoints" → Searches and displays content with metadata

**Editing Content:**
- "Update the introduction section with the new requirements" → Uses `edit_section` to modify specific parts
- "Add a new section about testing procedures" → Creates or updates sections within pages

**Creating Content:**
- "Create a new page under 'API Documentation' about authentication" → Uses `create_child_page`
- "Add documentation for the user management feature" → Creates structured content

**Navigation:**
- "Show me the structure of our documentation space" → Uses `get_page_structure`
- "Find all pages about deployment" → Uses `search_content` with filters

#### Example Chat Interactions:

```
User: "Read the project requirements document"
Agent: [Finds page by title] → [Reads article with metadata] → [Displays formatted content]

User: "Update the deployment section with the new Docker instructions"
Agent: [Locates page] → [Edits specific section] → [Confirms changes]

User: "Create a new troubleshooting page under the Operations section"
Agent: [Finds parent page] → [Creates child page] → [Returns page info and URL]
```

### Example Client Configuration

```json
{
  "mcpServers": {
    "slack": {
      "command": "node",
      "args": ["path/to/slack-mcp-server/server.js"],
      "env": {
        "SLACK_BOT_TOKEN": "your-token",
        "SLACK_APP_TOKEN": "your-app-token"
      }
    },
    "jira": {
      "command": "node",
      "args": ["path/to/jira-mcp-server/server.js"],
      "env": {
        "JIRA_BASE_URL": "https://your-instance.atlassian.net",
        "JIRA_EMAIL": "your-email@company.com",
        "JIRA_API_TOKEN": "your-token"
      }
    },
    "confluence": {
      "command": "node",
      "args": ["path/to/confluence-mcp-server/server.js"],
      "env": {
        "CONFLUENCE_BASE_URL": "https://your-instance.atlassian.net",
        "CONFLUENCE_EMAIL": "your-email@company.com",
        "CONFLUENCE_API_TOKEN": "your-token"
      }
    }
  }
}
```

## 🧪 Testing

Run the test script to verify your configuration:

```bash
./test-servers.sh
```

This will check:
- Environment variables are set
- Dependencies are installed
- Server files exist
- Basic connectivity (if credentials provided)

## 🏗️ Architecture

```
├── mcp-servers/
│   ├── slack/          # Slack MCP server
│   ├── jira/           # Jira MCP server
│   └── confluence/     # Confluence MCP server
├── mcp_config.json     # MCP client configuration
├── package.json        # Root dependencies and scripts
├── setup.sh           # Installation script
├── test-servers.sh    # Testing script
└── README.md          # This file
```

Each MCP server:
- Uses the official MCP SDK for protocol compliance
- Implements stdio transport for client communication
- Handles authentication via environment variables
- Provides service-specific tools and capabilities

## 🔒 Security Notes

- Never commit `.env` files to version control
- Use environment variables for all sensitive data
- Follow the principle of least privilege for API tokens
- Rotate tokens regularly

## 🐛 Troubleshooting

### Common Issues

1. **"Environment variable not found"**
   - Ensure `.env` file exists and is properly formatted
   - Check that variables are exported correctly

2. **"Authentication failed"**
   - Verify API tokens are correct and not expired
   - Check that your account has necessary permissions

3. **"Server won't start"**
   - Ensure Node.js 16+ is installed
   - Run `npm install` in the server directory
   - Check for port conflicts

4. **"Tool not found"**
   - Verify you're using the correct tool names
   - Check server logs for errors

### Getting Help

1. Check the server logs for detailed error messages
2. Verify your API credentials with direct API calls
3. Test each server individually before running together

## 📝 License

MIT License - see LICENSE file for details
