# Jira MCP Server

A Model Context Protocol server for interacting with Jira, focused on testing workflow management and release coordination.

## Features

- **Testing Progress Tracking**: Monitor tickets in Testing/QA statuses
- **NoTest Ticket Management**: Separate handling of infrastructure/non-testable tickets
- **Team-based Filtering**: Query tickets by team labels with automatic expansion
- **Domain Filtering**: Filter by deployment domain (frontend, backend, wordpress, remix)
- **Smart JQL Building**: Automatic query optimization and team label expansion

## Architecture

```
src/
├── server.ts           # MCP server, tool definitions, handlers
├── jira-client.ts      # Axios-based Jira REST API client
└── types.ts            # TypeScript interfaces (JiraConfig, JiraIssue, JiraBoard)
```

### Key Components

| File | Purpose |
|------|---------|
| [server.ts](src/server.ts) | Main MCP server with tool definitions and business logic |
| [jira-client.ts](src/jira-client.ts) | Jira REST API wrapper using axios |
| [types.ts](src/types.ts) | TypeScript interfaces |

### Business Logic Constants

Defined in `server.ts`:

**NoTest Labels** (excluded by default):
```typescript
NO_TEST_LABELS = ['NoTest', 'no-test', 'notest', 'noTest', 'Notest']
```

**Team Queries** (auto-expanded in JQL):
```typescript
TEAM_QUERIES = {
  'commercial': 'project = "Online and Projects Team" OR labels in (coreteam3, ...)',
  'skynetteam': 'labels in (SkynetTeam)',
  'puzzlesteam': 'project = "DragonBox Labs and Puzzles" OR labels in (PuzzlesTeam)',
  'gamefactory': 'labels in (engaging-learning, GameFactory)',
  'corporate': 'labels in (corporate-learning, coreteamx, KahootX)'
}
```

**Domain Queries** (for deployment slices):
```typescript
DOMAIN_QUERIES = {
  frontend: '(project = KAHOOT AND labels in (kahoot-frontend))',
  backend: '(project = BACK)',
  wordpress: '(project = OPT)',
  remix: '(labels in (kahoot-remix))'
}
```

## Tools

### `get_testing_summary`
Count tickets across testing statuses with optional domain/team breakdowns.

**Parameters:**
- `domain`: Filter by domain (all/frontend/backend/wordpress/remix)
- `separateNoTest`: Show NoTest counts separately
- `byTeam`: Include team breakdown

### `get_testing_remaining`
List tickets remaining in testing phases.

**Parameters:**
- `statuses`: Array of statuses (default varies by separateNoTest flag)
- `domain`: Filter by domain
- `separateNoTest`: Include NoTest tickets separately
- `maxResults`: Limit results (default: 50)

### `get_team_tickets`
Get tickets for a specific team in given status.

**Parameters:**
- `team`: Team name (commercial, skynetteam, puzzlesteam, etc.)
- `status`: Jira status to filter by
- `maxResults`: Limit results

### `search_issues`
JQL search with automatic team label expansion and NoTest filtering.

**Parameters:**
- `jql`: JQL query string
- `maxResults`: Limit results
- `includeNoTest`: Include NoTest tickets (default: false)

### `get_issue_details`
Get detailed information about a specific issue.

**Parameters:**
- `issueKey`: Issue key (e.g., "BACK-1234")

### `get_boards`
List available Jira boards.

**Parameters:**
- `type`: Filter by board type (scrum/kanban/simple)

### `update_issue_labels`
Update labels on an issue.

**Parameters:**
- `issueKey`: Issue key
- `labels`: Array of label strings

### `update_issue_components`
Update components on an issue.

**Parameters:**
- `issueKey`: Issue key
- `componentIds`: Array of component IDs

## CLI Testing

### Setup
```bash
cd /Users/olegshevchenko/Sourses/MCP
export $(grep -v '^#' .env | grep -v '^$' | xargs)
```

### Build
```bash
cd mcp-servers/jira && npm run build && cd ../..
```

### Test Commands

**List tools:**
```bash
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | node mcp-servers/jira/dist/server.js 2>/dev/null | jq '.result.tools[].name'
```

**Get testing summary:**
```bash
echo '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_testing_summary","arguments":{}}}' | node mcp-servers/jira/dist/server.js 2>/dev/null
```

**Get testing remaining:**
```bash
echo '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_testing_remaining","arguments":{"maxResults":10}}}' | node mcp-servers/jira/dist/server.js 2>/dev/null
```

**Search issues:**
```bash
echo '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"search_issues","arguments":{"jql":"status = \"In QA\" AND project = BACK","maxResults":5}}}' | node mcp-servers/jira/dist/server.js 2>/dev/null
```

**Get issue details:**
```bash
echo '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_issue_details","arguments":{"issueKey":"BACK-1234"}}}' | node mcp-servers/jira/dist/server.js 2>/dev/null
```

### One-liner (full testing summary)
```bash
cd /Users/olegshevchenko/Sourses/MCP && export $(grep -v '^#' .env | grep -v '^$' | xargs) && echo '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_testing_summary","arguments":{}}}' | node mcp-servers/jira/dist/server.js 2>/dev/null | jq -r '.result.content[0].text'
```

## Configuration

### Environment Variables
```bash
JIRA_BASE_URL=https://yoursite.atlassian.net
JIRA_EMAIL=your-email@company.com
JIRA_API_TOKEN=your-api-token
```

### Get API Token
1. Go to https://id.atlassian.com/manage-profile/security/api-tokens
2. Create new API token
3. Copy to `.env` as `JIRA_API_TOKEN`

## Logic Highlights

- **Robust JQL Building**: Automatically strips ORDER BY clauses to prevent syntax errors
- **Conditional Defaults**: Status defaults change based on NoTest inclusion
- **Project Filtering**: Hardcoded to KAHOOT/BACK/OPT for focused testing scope
- **Team Expansion**: Maps shorthand team names to full label queries
- **Smart NoTest Filtering**: By default excludes NoTest tickets to match testing board behavior

## Output Format

All tools return tickets in consistent format:
```
1. **BACK-13128** - NPE during purgeKahootSessionData
   🔹 In QA | 🔥 Major | 👤 Colin Smith | 🏷️ Commercial | 🧩 platform-rest-api | 🔗 <URL|Open>
```

## Troubleshooting

| Error | Fix |
|-------|-----|
| `Missing Jira configuration` | Set JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN in .env |
| `Search failed: JQL syntax error` | Check JQL query, avoid ORDER BY in filters |
| `401 Unauthorized` | API token expired or invalid |
| `Connection test failed` | Verify base URL format (https://org.atlassian.net) |
