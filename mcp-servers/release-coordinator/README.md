# Release Coordinator MCP Server

A minimal, format-only MCP server that synthesizes a comprehensive release overview from inputs you provide. It doesn’t call other servers itself; orchestrate Jira/Slack calls in your client (or script), then pass the results here for clean, link-friendly output.

## Why format-only?

MCP servers run in separate processes. Cross-calling servers from within another server is brittle. Keeping this server focused on formatting makes it fast, reliable, and easy to evolve.

## Tool

- get_comprehensive_release_overview
  - inputs (all optional, strings, Markdown supported):
    - jiraTestingSummary: Manual testing summary (e.g., from Jira get_testing_summary).
    - autoTestStatus: Automated test status (e.g., from Slack get_auto_test_status).
    - blockingIssues: Blocking issues list (e.g., from Slack get_blocking_issues).
    - date: Label for the header (e.g., 2025-09-01 or "today").

## Orchestration pattern

1) Call specialized servers in parallel from your client:
   - Jira → get_testing_summary
   - Slack → get_auto_test_status, get_blocking_issues
2) Pass their outputs into this server’s tool.

### Example flow (pseudocode)

```ts
const [jiraSummary, autoStatus, blockers] = await Promise.all([
  callTool('jira', 'get_testing_summary', { /* filters */ }),
  callTool('slack', 'get_auto_test_status', { date: 'today' }),
  callTool('slack', 'get_blocking_issues', { date: 'today', includeMitigated: true })
]);

const overview = await callTool('release-coordinator', 'get_comprehensive_release_overview', {
  jiraTestingSummary: jiraSummary.text,
  autoTestStatus: autoStatus.text,
  blockingIssues: blockers.text,
  date: new Date().toISOString().slice(0,10)
});
```

### Sample output

```
## 🚀 Release Status Overview — 2025-09-01

### 📊 Manual Testing Status (Jira)
- In QA: 14 (FE: 6, BE: 7, WP: 1)
- Testing: 9 (FE: 3, BE: 5, WP: 1)
- Test Passed: 18

### 🤖 Automated Test Status (Slack)
- Suites: 12/12 green (2 known flaky muted)
- Last run: 08:40, duration 13m

### 🚨 Blocking Issues (Slack)
- JIRA-123: Payment rollback on EU shard (mitigated, link → https://...)
- Thread: https://slack.com/app_redirect?channel=C123&message_ts=...

---
Notes:
- This server formats inputs only. Orchestrate calls to Jira/Slack MCP servers in your client, then pass the results here.
- Inputs accept Markdown for rich display (links, lists).
```

## Run

The server is registered in `.vscode/mcp.json`. Ensure Jira/Slack servers are configured with valid credentials.

```bash
# Build all servers (or build this package directly)
npm run build

# Start just this server
node mcp-servers/release-coordinator/dist/server.js
```