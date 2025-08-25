# Jira MCP Server

A Model Context Protocol server for interacting with Jira, focused on testing workflow management.

## Features

- **Testing Progress Tracking**: Monitor tickets in Testing/QA statuses
- **NoTest Ticket Management**: Separate handling of infrastructure/non-testable tickets
- **Team-based Filtering**: Query tickets by team labels with automatic expansion
- **Project Scoping**: Focus on core projects (KAHOOT, BACK, OPT)

## Key Tools

### `get_testing_remaining`
Lists tickets in testing phases with conditional defaults:
- **Without NoTest** (`separateNoTest=false`): Defaults to "Testing" status only
- **With NoTest** (`separateNoTest=true`): Defaults to "In QA" + "Testing" statuses

Project filtering automatically excludes non-core projects (DBSLA, INFRA, etc.).

### `get_testing_summary`
Provides count summaries across testing statuses, optionally broken down by domain (frontend/backend/wordpress/other).

### `search_issues`
JQL search with automatic team label expansion and NoTest filtering options.

## Configuration

Set environment variables:
```bash
JIRA_BASE_URL=https://yoursite.atlassian.net
JIRA_EMAIL=your-email@company.com
JIRA_API_TOKEN=your-api-token
```

## Usage

```bash
npm run build
npm start
```

The server connects via stdio for MCP integration.

## Logic Highlights

- **Robust JQL Building**: Automatically strips ORDER BY clauses to prevent syntax errors
- **Conditional Defaults**: Status defaults change based on NoTest inclusion
- **Project Filtering**: Hardcoded to KAHOOT/BACK/OPT for focused testing scope
- **Team Expansion**: Maps shorthand team names to full label queries