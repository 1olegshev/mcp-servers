# MCP Servers

Model Context Protocol servers for Slack, Jira, Confluence, and release coordination. Built for QA workflows and daily release status reporting.

## Quick Start

```bash
# 1. Install
git clone <repo> && cd mcp-servers
npm install

# 2. Configure credentials (see below)
cp env.example .env
# Edit .env with your tokens

# 3. Build & verify
npm run build
./test-servers.sh
```

## Credentials Setup

All servers load credentials from `.env` in project root. Never put credentials in `mcp.json`.

### Jira & Confluence

```bash
JIRA_BASE_URL=https://yourorg.atlassian.net
JIRA_EMAIL=your-email@company.com
JIRA_API_TOKEN=your-api-token

CONFLUENCE_BASE_URL=https://yourorg.atlassian.net
CONFLUENCE_EMAIL=your-email@company.com
CONFLUENCE_API_TOKEN=your-api-token
```

Get API tokens: https://id.atlassian.com/manage-profile/security/api-tokens

### Slack (XOXC/XOXD Session Auth)

```bash
SLACK_MCP_XOXC_TOKEN=xoxc-your-session-token
SLACK_MCP_XOXD_TOKEN=xoxd-your-cookie-value
```

**Extract tokens:**
1. Open Slack in browser, log in
2. DevTools (F12) → **Application** → **Cookies** → `https://app.slack.com`
3. Find `d` cookie → this is **XOXD** (starts with `xoxd-`)
4. **Network** tab → reload → find `api.slack.com` request
5. In headers, find `Authorization: Bearer xoxc-...` → this is **XOXC**

See [slack/README.md](mcp-servers/slack/README.md#how-to-extract-tokens) for detailed instructions.

### VS Code MCP Integration

```bash
cp .vscode/mcp.json.example .vscode/mcp.json
# Update paths in mcp.json to your project location
# Restart VS Code after changes
```

## Documentation

Each server has its own README with tools, CLI testing, and troubleshooting:

| Server | Purpose | Docs |
|--------|---------|------|
| **Slack** | Channel messages, auto test analysis, blocking issue detection | [slack/README.md](mcp-servers/slack/README.md) |
| **Jira** | Testing status, ticket queries, team filtering | [jira/README.md](mcp-servers/jira/README.md) |
| **Confluence** | Page search, article reading/writing | [confluence/README.md](mcp-servers/confluence/README.md) |
| **Release Coordinator** | Orchestrates Jira+Slack into release reports | [release-coordinator/README.md](mcp-servers/release-coordinator/README.md) |
| **Shared** | Common utilities (env loading, errors, types) | [shared/README.md](mcp-servers/shared/README.md) |

### Slack Deep-Dive Docs

The Slack server is the most complex and has additional documentation:

| Doc | Purpose |
|-----|---------|
| [AI_AGENT_GUIDE.md](mcp-servers/slack/docs/AI_AGENT_GUIDE.md) | Architecture, file structure, patterns |
| [QUICK_REFERENCE.md](mcp-servers/slack/docs/QUICK_REFERENCE.md) | Code examples, common modifications |
| [TYPE_SYSTEM.md](mcp-servers/slack/docs/TYPE_SYSTEM.md) | Type definitions, data flows |
| [SECURITY.md](mcp-servers/slack/SECURITY.md) | Auth security, threat model |
| [TESTING_DOCUMENTATION.md](mcp-servers/slack/TESTING_DOCUMENTATION.md) | Test coverage, Jest setup |

## Tool Quick Reference

| Task | Tool | Server |
|------|------|--------|
| Full release status report | `get_comprehensive_release_overview` | release-coordinator |
| Find blocking issues | `get_blocking_issues` | slack |
| Check auto test results | `get_auto_test_status` | slack |
| Count tickets by status | `get_testing_summary` | jira |
| List tickets in QA/Testing | `get_testing_remaining` | jira |
| Search Jira with JQL | `search_issues` | jira |
| Read Confluence page | `read_article` | confluence |
| Search Confluence | `search_pages` | confluence |
| Post to Slack | `send_message` | slack (restricted to #qa-release-status) |

## Architecture Invariants

These are intentional constraints - do not change without explicit request:

| Constraint | Location | Reason |
|------------|----------|--------|
| Slack writes only to `#qa-release-status` | `slack/src/auth/slack-auth.ts` | Prevents accidental posts |
| NoTest labels excluded by default | `jira/src/server.ts` | Matches testing board |
| Team query mappings are hardcoded | `jira/src/server.ts` | Business logic |
| Slack markdown (not standard) | All Slack output | `*bold*` not `**bold**`, `<url\|text>` not `[text](url)` |
| ESM imports need `.js` extension | All TypeScript | Required for ES modules |

## Running Servers

```bash
npm run dev              # All servers with auto-reload
npm run start            # All servers production mode
npm run start:slack      # Individual server
npm run start:jira
npm run start:confluence
npm run start:release-coordinator
```

## Troubleshooting

| Error | Fix |
|-------|-----|
| `Missing X configuration` | Check `.env` has required variables |
| `401 Unauthorized` | API token expired or invalid |
| `Cannot find module` | Run `npm run build` |
| `Write access restricted` | Slack writes only allowed to #qa-release-status |
| ESM/require errors | Imports must use `.js` extension |

### VS Code MCP Caching

After rebuilding a server, VS Code caches the old instance. MCP tools will use OLD code until you restart VS Code (Cmd+Shift+P → "Reload Window").

## Project Structure

```
├── README.md                    # This file
├── .env                         # Credentials (gitignored)
├── env.example                  # Credential template
├── mcp_config.json              # MCP server definitions
├── mcp-servers/
│   ├── slack/                   # Slack MCP server
│   │   ├── README.md            # Slack docs
│   │   ├── docs/                # Deep-dive documentation
│   │   └── src/
│   ├── jira/                    # Jira MCP server
│   │   ├── README.md
│   │   └── src/
│   ├── confluence/              # Confluence MCP server
│   │   ├── README.md
│   │   └── src/
│   ├── release-coordinator/     # Orchestration server
│   │   ├── README.md
│   │   └── src/
│   └── shared/                  # Shared utilities
│       ├── README.md
│       └── src/
└── scripts/                     # Automation (cron jobs)
    └── README.md
```
