# AI Agent Guide

**Start here if you're an AI agent working with this codebase.**

## 30-Second Orientation

This is a **Model Context Protocol (MCP)** workspace with 4 servers that integrate Slack, Jira, and Confluence for **release management and QA coordination**. The primary use case is generating daily release status reports.

```
┌─────────────────────────────────────────────────────────────────┐
│                    Release Status Workflow                       │
├─────────────────────────────────────────────────────────────────┤
│  Jira Server          Slack Server         Release Coordinator  │
│  ┌─────────┐          ┌─────────┐          ┌─────────────────┐  │
│  │ Testing │          │ Auto    │          │ Orchestrates    │  │
│  │ tickets │ ──────►  │ tests   │ ──────►  │ all data into   │  │
│  │ status  │          │ blockers│          │ release report  │  │
│  └─────────┘          └─────────┘          └─────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Decision Trees

### What Tool Should I Use?

| I need to... | Use this | Server |
|--------------|----------|--------|
| Get full release status report | `get_comprehensive_release_overview` | release-coordinator |
| Find blocking issues from Slack | `get_blocking_issues` | slack |
| Check automated test results | `get_auto_test_status` | slack |
| Count tickets by testing status | `get_testing_summary` | jira |
| List tickets remaining in QA | `get_testing_remaining` | jira |
| Search Jira with JQL | `search_issues` | jira |
| Get single ticket details | `get_issue_details` | jira |
| Read a Confluence page | `read_article` | confluence |
| Search Confluence pages | `search_pages` | confluence |
| Post message to Slack | `send_message` | slack ⚠️ |

⚠️ **Slack writes are restricted to `#qa-release-status` channel only.**

### What Should I NOT Modify?

These files contain critical business logic or security controls. Do not change without explicit user request:

| File | What It Controls | Why It Matters |
|------|------------------|----------------|
| `mcp-servers/slack/src/auth/slack-auth.ts` | Write channel restrictions | Only `#qa-release-status` allows writes |
| `mcp-servers/jira/src/server.ts` → `TEAM_QUERIES` | Team → JQL mappings | Business logic for team filtering |
| `mcp-servers/jira/src/server.ts` → `NO_TEST_LABELS` | NoTest ticket exclusion | Matches testing board behavior |
| `mcp-servers/jira/src/server.ts` → `DOMAIN_QUERIES` | Domain → JQL mappings | Frontend/backend/remix filtering |
| `.env` | API credentials | Never commit, never log contents |

---

## Common Workflows

### Generate Daily Release Status
```
1. get_comprehensive_release_overview (postToSlack: false)
   → Review output for accuracy
2. If correct: get_comprehensive_release_overview (postToSlack: true)
   → Posts formatted report to #qa-release-status
```

### Investigate a Failing Test
```
1. get_auto_test_status → Find failing test suite and thread link
2. get_thread_replies (channel, thread_ts) → Read discussion
3. Check for: "reviewed", "rerun requested", "known flaky", "fix in progress"
4. Report findings with thread context
```

### Find All Release Blockers
```
1. get_blocking_issues → Slack-reported blockers (with LLM classification)
2. get_testing_remaining → Tickets still in QA/Testing
3. search_issues (jql: "priority = Blocker") → Jira priority blockers
4. Cross-reference and deduplicate
```

### Check Testing Progress for a Team
```
1. get_testing_summary (byTeam: true) → Overview counts
2. get_team_tickets (team: "commercial", status: "In QA") → Specific tickets
3. Format response with ticket links
```

### Update Confluence Documentation
```
1. search_pages (query: "topic") → Find existing page
2. read_article (pageId) → Get current content
3. preview_changes (pageId, newContent) → Verify changes
4. update_article (pageId, newContent, publish: true) → Apply changes
```

---

## Quick Reference

### Server Capability Matrix

| Task | Server | Tool | File |
|------|--------|------|------|
| **Slack Operations** |
| Send message | slack | `send_message` | [handlers/messaging.ts](mcp-servers/slack/src/handlers/messaging.ts) |
| Get channel history | slack | `get_channel_history` | [handlers/messaging.ts](mcp-servers/slack/src/handlers/messaging.ts) |
| Search messages | slack | `search_messages` | [handlers/messaging.ts](mcp-servers/slack/src/handlers/messaging.ts) |
| Find blocking issues | slack | `get_blocking_issues` | [handlers/analysis.ts](mcp-servers/slack/src/handlers/analysis.ts) |
| Get auto test status | slack | `get_auto_test_status` | [handlers/analysis.ts](mcp-servers/slack/src/handlers/analysis.ts) |
| **Jira Operations** |
| Search tickets (JQL) | jira | `search_issues` | [server.ts](mcp-servers/jira/src/server.ts) |
| Get testing summary | jira | `get_testing_summary` | [server.ts](mcp-servers/jira/src/server.ts) |
| Get tickets remaining | jira | `get_testing_remaining` | [server.ts](mcp-servers/jira/src/server.ts) |
| Update labels | jira | `update_issue_labels` | [server.ts](mcp-servers/jira/src/server.ts) |
| **Confluence Operations** |
| Search pages | confluence | `search_pages` | [server.ts](mcp-servers/confluence/src/server.ts) |
| Read article | confluence | `read_article` | [server.ts](mcp-servers/confluence/src/server.ts) |
| Create/update pages | confluence | `create_article`, `update_article` | [server.ts](mcp-servers/confluence/src/server.ts) |
| **Orchestration** |
| Full release report | release-coordinator | `get_comprehensive_release_overview` | [server.ts](mcp-servers/release-coordinator/src/server.ts) |

### All Tools by Server

<details>
<summary><b>Slack Server (11 tools)</b></summary>

| Tool | Purpose | Read/Write |
|------|---------|------------|
| `send_message` | Send message to channel | ⚠️ Write (restricted to #qa-release-status) |
| `list_channels` | List workspace channels | ✅ Read |
| `get_channel_history` | Get recent messages | ✅ Read |
| `search_messages` | Search workspace | ✅ Read |
| `add_reaction` | Add emoji reaction | ⚠️ Write |
| `get_thread_replies` | Get thread replies | ✅ Read |
| `get_message_details` | Get full message structure | ✅ Read |
| `find_bot_messages` | Find/analyze bot messages | ✅ Read |
| `get_blocking_issues` | Find blocking issues | ✅ Read |
| `get_auto_test_status` | Analyze test results | ✅ Read |
| `get_release_status_overview` | Comprehensive release status | ✅ Read |

</details>

<details>
<summary><b>Jira Server (8 tools)</b></summary>

| Tool | Purpose | Read/Write |
|------|---------|------------|
| `search_issues` | JQL search with NoTest filtering | ✅ Read |
| `get_testing_summary` | Count tickets by testing status | ✅ Read |
| `get_testing_remaining` | List tickets in QA/Testing | ✅ Read |
| `get_team_tickets` | Get team's tickets | ✅ Read |
| `get_issue_details` | Get single issue details | ✅ Read |
| `get_boards` | List Jira boards | ✅ Read |
| `update_issue_labels` | Update issue labels | ⚠️ Write |
| `update_issue_components` | Update issue components | ⚠️ Write |

</details>

<details>
<summary><b>Confluence Server (9 tools)</b></summary>

| Tool | Purpose | Read/Write |
|------|---------|------------|
| `find_recent_qa_articles` | Find QA articles | ✅ Read |
| `read_article` | Read article by ID | ✅ Read |
| `search_pages` | Search by keywords | ✅ Read |
| `get_spaces` | List spaces | ✅ Read |
| `search_by_author` | Search by author | ✅ Read |
| `update_article` | Update existing article | ⚠️ Write |
| `preview_changes` | Preview before applying | ✅ Read |
| `create_qa_draft` | Create draft in safe space | ⚠️ Write |
| `create_article` | Create new article | ⚠️ Write |

</details>

<details>
<summary><b>Release Coordinator (1 tool)</b></summary>

| Tool | Purpose | Read/Write |
|------|---------|------------|
| `get_comprehensive_release_overview` | Orchestrate full release report | ✅ Read (formats inputs only) |

</details>

---

## Environment Variables

All variables are defined in `.env` at project root. Template: [env.example](env.example)

```bash
# Slack (XOXC/XOXD session tokens - preferred)
SLACK_MCP_XOXC_TOKEN=xoxc-...    # Session bearer token
SLACK_MCP_XOXD_TOKEN=xoxd-...    # Session cookie value

# Slack (Legacy bot tokens - fallback)
SLACK_BOT_TOKEN=xoxb-...         # Bot OAuth token
SLACK_APP_TOKEN=xapp-...         # App-level token

# Jira
JIRA_BASE_URL=https://yourorg.atlassian.net
JIRA_EMAIL=your-email@company.com
JIRA_API_TOKEN=your-api-token

# Confluence
CONFLUENCE_BASE_URL=https://yourorg.atlassian.net
CONFLUENCE_EMAIL=your-email@company.com
CONFLUENCE_API_TOKEN=your-api-token
```

---

## CLI Testing (Critical for AI Agents)

### Quick Setup
```bash
# From project root (or use: cd "$(git rev-parse --show-toplevel)")
export $(grep -v '^#' .env | grep -v '^$' | xargs)
```

### Test Any Server Tool
```bash
# Pattern: echo JSON-RPC | node <server>/dist/server.js 2>/dev/null

# List available tools
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | node mcp-servers/slack/dist/server.js 2>/dev/null | jq '.result.tools[].name'

# Call a tool
echo '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"TOOL_NAME","arguments":{}}}' | node mcp-servers/SERVER/dist/server.js 2>/dev/null
```

### Common Test Commands

**Slack:**
```bash
# Get auto test status (safe, read-only)
echo '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_auto_test_status","arguments":{}}}' | node mcp-servers/slack/dist/server.js 2>/dev/null

# Get blocking issues
echo '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_blocking_issues","arguments":{}}}' | node mcp-servers/slack/dist/server.js 2>/dev/null
```

**Jira:**
```bash
# Get testing summary
echo '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_testing_summary","arguments":{}}}' | node mcp-servers/jira/dist/server.js 2>/dev/null

# Search issues
echo '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"search_issues","arguments":{"jql":"status = \"In QA\"","maxResults":5}}}' | node mcp-servers/jira/dist/server.js 2>/dev/null
```

**Confluence:**
```bash
# List spaces
echo '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_spaces","arguments":{}}}' | node mcp-servers/confluence/dist/server.js 2>/dev/null
```

### Build Before Testing
```bash
npm run build  # Builds all servers
# Or individually:
cd mcp-servers/slack && npm run build
```

---

## Project Structure

```
./  (project root)
├── AGENT.md                 # ◄── YOU ARE HERE
├── README.md                # Human-oriented overview
├── MCP_SETUP.md            # VS Code MCP setup
├── .env                    # Environment variables (secrets)
├── env.example             # Environment template
├── mcp_config.json         # MCP server configurations
├── package.json            # Workspace scripts
│
├── mcp-servers/
│   ├── slack/              # Most complex server
│   │   ├── src/
│   │   │   ├── server.ts           # Entry point, tool registration
│   │   │   ├── auth/               # Authentication (slack-auth.ts)
│   │   │   ├── clients/            # Slack API wrapper (slack-client.ts)
│   │   │   ├── handlers/           # Tool handlers (messaging.ts, analysis.ts)
│   │   │   ├── services/           # Business logic
│   │   │   │   ├── issue-detector.ts
│   │   │   │   ├── test-analyzer.ts
│   │   │   │   ├── release-analyzer.ts
│   │   │   │   └── issue-detection/  # Modular pipeline
│   │   │   ├── utils/              # Helpers (analyzers.ts, date-utils.ts)
│   │   │   └── types/              # TypeScript definitions
│   │   ├── docs/
│   │   │   ├── AI_AGENT_GUIDE.md   # Detailed architecture
│   │   │   ├── QUICK_REFERENCE.md  # Code patterns
│   │   │   └── TYPE_SYSTEM.md      # Type definitions
│   │   └── dist/                   # Compiled output
│   │
│   ├── jira/
│   │   └── src/
│   │       ├── server.ts           # Tools + handlers (single file)
│   │       ├── jira-client.ts      # Jira API client
│   │       └── types.ts            # TypeScript interfaces
│   │
│   ├── confluence/
│   │   └── src/
│   │       ├── server.ts           # Tools + handlers
│   │       ├── confluence-client.ts # Confluence API client
│   │       └── types.ts            # TypeScript interfaces
│   │
│   └── release-coordinator/
│       └── src/
│           ├── server.ts           # Orchestration tool
│           └── mcp-clients.ts      # Helper for calling other servers
│
├── scripts/
│   ├── release-status-auto.mjs     # Automated release posting
│   ├── cron-release-wrapper.sh     # Cron wrapper
│   └── README.md                   # Automation docs
│
└── logs/                           # Automation logs
```

---

## Common Tasks

### "Where do I find X?"

| Looking for... | Location |
|----------------|----------|
| Tool definitions | `server.ts` in each server |
| Slack API calls | [mcp-servers/slack/src/clients/slack-client.ts](mcp-servers/slack/src/clients/slack-client.ts) |
| Jira API calls | [mcp-servers/jira/src/jira-client.ts](mcp-servers/jira/src/jira-client.ts) |
| Confluence API calls | [mcp-servers/confluence/src/confluence-client.ts](mcp-servers/confluence/src/confluence-client.ts) |
| Issue detection logic | [mcp-servers/slack/src/services/issue-detector.ts](mcp-servers/slack/src/services/issue-detector.ts) |
| Test analysis logic | [mcp-servers/slack/src/services/test-analyzer.ts](mcp-servers/slack/src/services/test-analyzer.ts) |
| Date utilities | [mcp-servers/slack/src/utils/date-utils.ts](mcp-servers/slack/src/utils/date-utils.ts) |
| Text analyzers | [mcp-servers/slack/src/utils/analyzers.ts](mcp-servers/slack/src/utils/analyzers.ts) |
| Type definitions | `types.ts` or `types/index.ts` in each server |
| LLM classification | [mcp-servers/slack/src/services/issue-detection/services/llm-classifier.service.ts](mcp-servers/slack/src/services/issue-detection/services/llm-classifier.service.ts) |

### Adding a New Tool

1. **Define tool schema** in `server.ts`:
```typescript
{
  name: 'my_new_tool',
  description: 'Does something useful',
  inputSchema: {
    type: 'object',
    properties: {
      param1: { type: 'string', description: 'Required param' }
    },
    required: ['param1']
  }
}
```

2. **Add route** in `CallToolRequestSchema` handler:
```typescript
case 'my_new_tool':
  return await this.handler.myNewTool(toolArgs);
```

3. **Implement handler** in appropriate handler file.

### Modifying Business Logic

- **Issue detection**: Edit [services/issue-detector.ts](mcp-servers/slack/src/services/issue-detector.ts) or the modular pipeline in `services/issue-detection/`
- **Test analysis**: Edit [services/test-analyzer.ts](mcp-servers/slack/src/services/test-analyzer.ts)
- **Jira queries**: Edit [jira-client.ts](mcp-servers/jira/src/jira-client.ts)

---

## Critical Guidelines

### Slack Formatting (CRITICAL)
Use **Slack markdown**, NOT standard markdown:
```typescript
// ✅ CORRECT (Slack)
output += `*Bold Text*`;                    // Single asterisks
output += `<https://url.com|Link Text>`;    // Angle brackets

// ❌ WRONG (Standard markdown)
output += `**Bold Text**`;                  // Double asterisks
output += `[Link Text](https://url.com)`;   // Square brackets
```

### Write Access Restrictions
- **Slack**: Only `#qa-release-status` channel allows writes
- Enforced in [auth/slack-auth.ts](mcp-servers/slack/src/auth/slack-auth.ts)

### ESM Modules
- All servers use ES modules
- Imports must include `.js` extension: `import { foo } from './bar.js'`
- Run `npm run build` after any TypeScript changes

---

## Architecture Invariants

These are intentional design decisions. Do not "fix" or "improve" them without explicit user request:

| Invariant | Location | Reason |
|-----------|----------|--------|
| Slack writes only to `#qa-release-status` | `slack-auth.ts:validateWriteAccess()` | Safety: prevents accidental spam to other channels |
| NoTest labels excluded by default | `jira/server.ts:NO_TEST_LABELS` | Matches testing board behavior |
| Team query mappings are hardcoded | `jira/server.ts:TEAM_QUERIES` | Business logic agreed with stakeholders |
| Slack markdown, NOT standard markdown | All Slack output formatting | Slack renders `*bold*` not `**bold**`, `<url\|text>` not `[text](url)` |
| ESM imports require `.js` extension | All TypeScript files | Required for ES modules to work |
| LLM classification is optional | `llm-classifier.service.ts` | Falls back to regex when Ollama unavailable |
| Deduplication before LLM | `issue-detection.pipeline.ts` | Minimize expensive LLM calls |

---

## Deep Dive Documentation

| Topic | Document |
|-------|----------|
| Slack architecture & patterns | [mcp-servers/slack/docs/AI_AGENT_GUIDE.md](mcp-servers/slack/docs/AI_AGENT_GUIDE.md) |
| Code patterns & examples | [mcp-servers/slack/docs/QUICK_REFERENCE.md](mcp-servers/slack/docs/QUICK_REFERENCE.md) |
| Type system | [mcp-servers/slack/docs/TYPE_SYSTEM.md](mcp-servers/slack/docs/TYPE_SYSTEM.md) |
| Cron automation | [scripts/README.md](scripts/README.md) |
| VS Code setup | [MCP_SETUP.md](MCP_SETUP.md) |

---

## Troubleshooting

| Error | Fix |
|-------|-----|
| `Missing Slack authentication` | Run `export $(grep -v '^#' .env | grep -v '^$' | xargs)` |
| `Cannot find module` | Run `npm run build` in server directory |
| `ENOENT dist/server.js` | Wrong directory - `cd` to project root |
| `Write access restricted` | Only #qa-release-status allows Slack writes |
| ESM/require errors | Ensure imports use `.js` extension |
