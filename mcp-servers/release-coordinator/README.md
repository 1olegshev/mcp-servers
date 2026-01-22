# Release Coordinator MCP Server

A minimal, orchestration-focused MCP server that synthesizes comprehensive release status reports by coordinating data from Jira and Slack servers.

## AI Agent Quick Reference

| What | Where |
|------|-------|
| Entry point | [src/server.ts](src/server.ts) — tools + orchestration logic |
| Build | `npm run build` |
| Tools | 2 tools: `get_comprehensive_release_overview`, `get_weekly_blockers_report` |
| Mode | Self-orchestrating (default) or format-only |

**Primary use case**: Daily release status reports combining Jira testing status + Slack auto tests + blocking issues.

---

## Purpose

This server can operate in two modes:

1. **Format-only mode**: Receives pre-fetched data and formats it into a release report
2. **Self-orchestrating mode**: Internally calls Jira/Slack MCP servers to fetch data, then formats the report

## Architecture

```
src/
└── server.ts       # Main MCP server with orchestration logic
```

### Key Components

| File | Purpose |
|------|---------|
| [server.ts](src/server.ts) | MCP server, tool definition, orchestration logic |

### Data Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                    Release Coordinator Flow                          │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  Option A: Self-orchestrating (no inputs provided)                  │
│  ┌──────────┐     ┌──────────┐     ┌──────────────────┐             │
│  │   Jira   │────▶│  Slack   │────▶│ Format & Output  │             │
│  │  Server  │     │  Server  │     │    (or Post)     │             │
│  └──────────┘     └──────────┘     └──────────────────┘             │
│       │                │                    │                        │
│       ▼                ▼                    ▼                        │
│   Testing          Auto Tests          Comprehensive                 │
│   Summary          + Blockers          Release Report                │
│                                                                      │
│  Option B: Format-only (inputs provided by caller)                  │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │  jiraTestingSummary + autoTestStatus + blockingIssues       │    │
│  │                          ↓                                   │    │
│  │                   Format & Output                            │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

## Tool

### `get_comprehensive_release_overview`

Generates a comprehensive release status report.

**Parameters (all optional):**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `jiraTestingSummary` | string | (auto-fetch) | Pre-fetched Jira testing summary |
| `autoTestStatus` | string | (auto-fetch) | Pre-fetched Slack auto test status |
| `blockingIssues` | string | (auto-fetch) | Pre-fetched Slack blocking issues |
| `testManagerUpdate` | string | (auto-fetch) | Pre-fetched test manager release decision |
| `date` | string | today | Date label for header (ISO or "today") |
| `channel` | string | "functional-testing" | Slack channel for auto-fetch |
| `boardId` | number | 23 | Jira board ID for auto-fetch |
| `domain` | string | "all" | Domain filter (all/frontend/backend/wordpress/remix) |
| `separateNoTest` | boolean | false | Show separate NoTest counts |
| `postToSlack` | boolean | false | Post result to #qa-release-status |

### Output Format

```
🚀 *Release Status Overview — 2025-09-01*

*📊 Manual Testing Status (Jira)*
[Testing summary content]

Testing board: <link|KAHOOT Board #23>

*🤖 Automated Test Status (Slack)*
[Auto test status content]

*🚨 Blocking Issues (Slack)*
[Blocking issues content]

👤 *Test Manager Decision*          (only shown if found)
✅ *We can release* _(updated in thread)_
> LLM-generated summary of current state
Manual testing: done • Autotests: reviewed
Hotfixes: TICKET-123
_5 thread replies analyzed_
<link|View message>

---
_Generated by MCP Release Coordinator_
```

The **Test Manager Decision** section is only included when a test manager update message is found for the given date. It uses LLM to analyze the main message and thread replies to capture the current state, which may have evolved from the original post (e.g., "hotfix" → "release").

**Possible decision displays:**
- ✅ *We can release* - ready to go
- 🔧 *Hotfixing first* - need to hotfix before release
- ⏸️ *Release postponed* - release delayed to another day
- 📅 *No release today (Friday)* - Friday pipeline aborted
- 🚫 *Pipeline aborted* - non-Friday pipeline abort
- ⏳ *Decision pending* - no clear decision yet

### `get_weekly_blockers_report`

Compiles all blocker tickets from the current week's test manager summary messages.

**Parameters (all optional):**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `channel` | string | "functional-testing" | Slack channel to scan |
| `weekOffset` | number | 0 | 0 = current week, -1 = previous week, -2 = two weeks ago, etc. |
| `postToSlack` | boolean | false | Post result to #qa-release-status |

**Date Range Logic:**
- Weekday (Mon-Fri): Monday of this week → today
- Weekend (Sat-Sun): Monday → Friday of this week

**Output Format:**

```
*Weekly Blockers Report (Jan 20-24, 2026)*

*Corporate Learning* (2 tickets)
• <URL|KAHOOT-1234> - Summary text here
  corporate-learning, feature-x | platform-api | Parent: <URL|KAHOOT-1000>

• <URL|KAHOOT-5678> - Another summary
  corporate-learning | auth-service

*Core3/Commercial* (1 ticket)
• <URL|BACK-999> - Billing issue
  commercial, billing-v2 | billing | Parent: <URL|BACK-800>

*Uncategorized* (1 ticket)
• <URL|OPT-123> - WordPress thing
  wordpress-prod | wp-theme

---
_4 unique blockers from 5 days analyzed_
_Generated by MCP Release Coordinator_
```

The report:
- Groups tickets by team (based on first matching label)
- Shows all labels and components for each ticket
- Includes parent ticket link if present
- Deduplicates tickets that appear on multiple days

## CLI Testing

### Setup
```bash
# From project root
export $(grep -v '^#' .env | grep -v '^$' | xargs)
```

### Build
```bash
cd mcp-servers/release-coordinator && npm run build && cd ../..
```

### Test Commands

**List tools:**
```bash
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | node mcp-servers/release-coordinator/dist/server.js 2>/dev/null | jq '.result.tools[].name'
```

**Get release overview (self-orchestrating - calls Jira/Slack internally):**
```bash
echo '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_comprehensive_release_overview","arguments":{}}}' | node mcp-servers/release-coordinator/dist/server.js 2>/dev/null
```

**Get release overview with specific date:**
```bash
echo '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_comprehensive_release_overview","arguments":{"date":"2025-09-01"}}}' | node mcp-servers/release-coordinator/dist/server.js 2>/dev/null
```

**Post to Slack:**
```bash
echo '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_comprehensive_release_overview","arguments":{"postToSlack":true}}}' | node mcp-servers/release-coordinator/dist/server.js 2>/dev/null
```

**Get weekly blockers report:**
```bash
echo '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_weekly_blockers_report","arguments":{}}}' | node mcp-servers/release-coordinator/dist/server.js 2>/dev/null
```

**Format-only mode (provide pre-fetched data):**
```bash
echo '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_comprehensive_release_overview","arguments":{"jiraTestingSummary":"In QA: 5, Testing: 3","autoTestStatus":"All tests passed","blockingIssues":"No blockers","date":"2025-09-01"}}}' | node mcp-servers/release-coordinator/dist/server.js 2>/dev/null
```

### One-liner (full release overview)
```bash
# From project root
export $(grep -v '^#' .env | grep -v '^$' | xargs) && echo '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_comprehensive_release_overview","arguments":{}}}' | node mcp-servers/release-coordinator/dist/server.js 2>/dev/null | jq -r '.result.content[0].text'
```

## Configuration

### Dependencies

This server requires the Jira and Slack MCP servers to be built:
```bash
npm run build  # From project root - builds all servers
```

### MCP Config

The server reads `/.vscode/mcp.json` for environment configuration:
```json
{
  "servers": {
    "slack": { "env": { "SLACK_MCP_XOXC_TOKEN": "...", ... } },
    "jira": { "env": { "JIRA_BASE_URL": "...", ... } }
  }
}
```

### Environment Variables

No direct environment variables required. Tokens are inherited from the MCP config for Jira/Slack orchestration.

## Usage Patterns

### 1. Automated Daily Report (Cron)

The scripts directory contains automation for daily reports:
```bash
# Runs daily at 12:05 PM via cron
./scripts/cron-release-wrapper.sh
```

See [scripts/README.md](../../scripts/README.md) for cron setup.

### 2. Manual Check via CLI

```bash
# Quick status check (self-orchestrating)
echo '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_comprehensive_release_overview","arguments":{}}}' | node mcp-servers/release-coordinator/dist/server.js 2>/dev/null | jq -r '.result.content[0].text'
```

### 3. Client-Orchestrated (Parallel Fetching)

```typescript
// Fetch in parallel from your client
const [jiraSummary, autoStatus, blockers] = await Promise.all([
  callTool('jira', 'get_testing_summary', {}),
  callTool('slack', 'get_auto_test_status', { date: 'today' }),
  callTool('slack', 'get_blocking_issues', { date: 'today' })
]);

// Pass to coordinator for formatting
const overview = await callTool('release-coordinator', 'get_comprehensive_release_overview', {
  jiraTestingSummary: jiraSummary.text,
  autoTestStatus: autoStatus.text,
  blockingIssues: blockers.text,
  date: new Date().toISOString().slice(0, 10)
});
```

## Troubleshooting

| Error | Fix |
|-------|-----|
| `Jira error` | Check Jira server is built and .env has JIRA_* variables |
| `Slack error` | Check Slack server is built and .env has SLACK_* variables |
| `mcp.json not found` | Ensure .vscode/mcp.json exists with server configs |
| `Failed to post to Slack` | Verify Slack write permissions (#qa-release-status) |

## Design Rationale

**Why format-only mode?**
- MCP servers run in separate processes
- Cross-calling servers from within another server can be brittle
- Format-only mode is fast, reliable, and easy to evolve
- Allows clients to parallelize data fetching for better performance

**Why self-orchestrating mode?**
- Convenience for simple use cases
- Single tool call generates complete report
- Useful for automated cron jobs

## Scheduling

### Daily Release Status (Mon-Fri at 11:15 CET)

Uses launchd + pmset. See [scripts/cron-release-wrapper.sh](../../scripts/cron-release-wrapper.sh).

### Weekly Blockers Report (Fridays at 14:00 CET)

**Scripts:**
- [scripts/weekly-blockers-auto.mjs](../../scripts/weekly-blockers-auto.mjs) - Node.js automation script
- [scripts/cron-weekly-blockers-wrapper.sh](../../scripts/cron-weekly-blockers-wrapper.sh) - Shell wrapper

**Setup:**

1. Create launchd plist at `~/Library/LaunchAgents/com.mcp.weekly-blockers.plist`:
```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.mcp.weekly-blockers</string>
    <key>ProgramArguments</key>
    <array>
        <string>/Users/olegshevchenko/Sourses/MCP/scripts/cron-weekly-blockers-wrapper.sh</string>
    </array>
    <key>StartCalendarInterval</key>
    <dict>
        <key>Weekday</key>
        <integer>5</integer>
        <key>Hour</key>
        <integer>14</integer>
        <key>Minute</key>
        <integer>0</integer>
    </dict>
    <key>StandardOutPath</key>
    <string>/Users/olegshevchenko/Sourses/MCP/logs/launchd-weekly-blockers.log</string>
    <key>StandardErrorPath</key>
    <string>/Users/olegshevchenko/Sourses/MCP/logs/launchd-weekly-blockers.log</string>
</dict>
</plist>
```

2. Load the agent:
```bash
launchctl load ~/Library/LaunchAgents/com.mcp.weekly-blockers.plist
```

3. Add pmset wake schedule for Fridays (optional - allows Mac to wake from sleep):
```bash
# Note: pmset only supports one repeating wake schedule
# If you need multiple wake times, consider using a single early wake + scripts that wait
sudo pmset repeat wakeorpoweron F 13:55:00
```

**Logs:**
- `logs/cron-weekly-blockers.log` - Main execution log
- `logs/launchd-weekly-blockers.log` - launchd stdout/stderr
