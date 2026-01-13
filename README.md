# MCP Servers Setup

This repository contains MCP (Model Context Protocol) server implementations for Slack, Jira, Confluence, and Release Coordination. These servers allow you to interact with these services through chat interfaces that support the MCP protocol.

## 🤖 For AI Agents

**👉 See [AGENT.md](AGENT.md)** — Complete guide for AI agents including tool matrix, decision trees, common workflows, CLI testing, and architecture.

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

3. **Install all dependencies:**
   ```bash
   npm run install:all
   ```

4. **Test your setup:**
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

# Release coordinator server
npm run start:release-coordinator
```

### Available Tools

> **Important:** When running through VS Code with MCP integration (like VS Code Insiders), tool names are prefixed with the server name (e.g., `mcp_slack_send_message`, `mcp_jira_search_issues`, `mcp_release-coord_get_comprehensive_release_overview`). When using direct MCP client connections, use the base tool names listed below.

#### Slack MCP Server

- **send_message**: Send messages to channels
- **list_channels**: List workspace channels
- **get_channel_history**: Get recent messages
- **search_messages**: Search workspace messages

#### Jira MCP Server

- **search_issues**: Search issues with JQL (with smart NoTest filtering and team expansion)
- **get_team_tickets**: Get tickets for specific teams using business logic
- **get_testing_summary**: Get summary counts for In QA, Testing, Test Passed with optional domain/team breakdowns
- **get_testing_remaining**: List tickets remaining in testing/QA phases with flexible status filtering
- **get_issue_details**: Get detailed issue information
- **get_boards**: List all available Jira boards with optional type filtering
- **update_issue_labels**: Update labels on Jira issues
- **update_issue_components**: Update components on Jira issues

**🔍 Smart NoTest Filtering:**
By default, all searches exclude tickets with NoTest labels (`NoTest`, `no-test`, `notest`, `noTest`, `Notest`) to match your testing board behavior. Use `includeNoTest: true` parameter to include them.

**🏢 Team Business Logic:**
Automatically maps team names to their projects and labels:
- **Commercial**: `project = "Online and Projects Team" OR labels in (coreteam3, Coreteam3, commercial, Commercial, onlineteam, onlineteam_IPM, marketplace, kahoot-remix)`
- **Online Team**: Same as Commercial (shared project space)
- **Marketplace**: Same as Commercial (shared project space)
- **SkynetTeam**: `labels in (SkynetTeam)`
- **PuzzlesTeam**: `project = "DragonBox Labs and Puzzles" OR labels in (PuzzlesTeam)`
- **GameFactory**: `labels in (engaging-learning, GameFactory)`
- **Corporate**: `labels in (corporate-learning, coreteamx, KahootX)`

**🎵 Remix Domain:**
Tickets with `kahoot-remix` labels are now tracked separately in domain breakdowns:
- Available as `remix` domain filter
- Shows in testing progress overview tables
- Released separately from main deployment

**📊 Consistent Output Format:**
All tools return tickets in the same format:
```
1. **BACK-13128** - NPE during purgeKahootSessionData
   🔹 In QA | 🔥 Major | 👤 Colin Smith | 🏷️ Commercial, NoTest | 🧩 platform-rest-api | 🔗 [Open](URL)
```

**Example Queries:**
- *"How many tickets ready for testing for commercial team?"* → Uses team business logic
- *"Show me SkynetTeam tickets ready for testing"* → `status = "In QA" AND labels = "SkynetTeam"`
- *"Backend bugs including NoTest tickets"* → `project = BACK AND issuetype = Bug` with `includeNoTest: true`

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

#### Release Coordinator MCP Server

- **get_comprehensive_release_overview**: Generate comprehensive release status reports

> **Note on Tool Names:** When using these servers through VS Code with MCP integration, tool names are prefixed with the server name. For example, `get_comprehensive_release_overview` becomes `mcp_release-coord_get_comprehensive_release_overview`. The functionality remains the same.

**🚀 Release Coordination:**
The Release Coordinator orchestrates data from Slack and Jira servers to provide a unified release status overview including:
- Manual testing status from Jira (In QA, Testing, Test Passed counts)
- Automated test results from Slack (test failures, reruns, status)
- Blocking issues analysis from Slack (critical/blocking issues detection)
- Formatted report with links to source systems
- Optional automatic posting to Slack #qa-release-status channel

**Example Usage:**
- *"Generate today's release status report"* → Simply call with no parameters: `get_comprehensive_release_overview()`
- *"Get release status and post to Slack"* → `get_comprehensive_release_overview({"postToSlack": true})`
- *"Show release status for September 2nd"* → `get_comprehensive_release_overview({"date": "2025-09-02"})`

**Smart Defaults:**
All parameters are optional with sensible defaults:
- `channel`: "functional-testing" (most common testing channel)
- `boardId`: 23 (main KAHOOT testing board)
- `domain`: "all" (include all domains: frontend, backend, wordpress, other)
- `date`: today's date (ISO format)
- `postToSlack`: false (just return the report, don't post)
- `separateNoTest`: false (standard NoTest handling)

**Parameters:**
All parameters are optional with smart defaults for immediate use:
- `channel`: Slack channel to analyze (default: "functional-testing")
- `boardId`: Jira board ID (default: 23 - main KAHOOT board)
- `domain`: Filter by domain - all/frontend/backend/wordpress/other (default: "all")
- `date`: Date for analysis - ISO format or "today" (default: current date)
- `postToSlack`: Whether to post results to #qa-release-status (default: false)
- `separateNoTest`: Show separate NoTest counts in Jira summary (default: false)

**Typical Usage:**
```
# Most common - just get today's status with defaults
get_comprehensive_release_overview()

# Post today's status to Slack
get_comprehensive_release_overview({"postToSlack": true})

# Get status for a specific date
get_comprehensive_release_overview({"date": "2025-09-01"})
```

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
    },
    "release-coordinator": {
      "command": "node",
      "args": ["path/to/release-coordinator-mcp-server/server.js"],
      "env": {}
    }
  }
}
```

## 🚀 Running the Servers

### Development Mode (All servers with auto-reload):
```bash
npm run dev
```

### Production Mode (All servers):
```bash
npm run start
```

### Individual Servers:
```bash
npm run dev:jira                    # Just Jira server
npm run start:confluence            # Just Confluence server  
npm run build:slack                 # Just build Slack server
npm run start:release-coordinator   # Just Release Coordinator server
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
│   ├── slack/              # Slack MCP server
│   ├── jira/               # Jira MCP server
│   ├── confluence/         # Confluence MCP server
│   └── release-coordinator/ # Release coordination orchestrator
├── mcp_config.json         # MCP client configuration
├── package.json            # Root dependencies and scripts
├── setup.sh               # Installation script
├── test-servers.sh        # Testing script
└── README.md              # This file
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
