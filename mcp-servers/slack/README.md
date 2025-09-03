# Slack MCP Server

A Model Context Protocol (MCP) server for interacting with Slack workspaces, designed specifically for release management and QA coordination workflows.

## Features

- **Release Status Ana### Troubleshooting

#### Authentication Issues

- **"invalid_auth" error**: Token expired, extract new XOXC/XOXD
- **"missing_scope" error**: User lacks permissions for requested action
- **Network errors**: Check if Slack is accessible

#### Token Extraction Problems

- **Can't find d cookie**: Clear browser cache and try again
- **XOXC not in headers**: Make sure you're logged in and making API requests
- **Tokens don't work**: Verify workspace and token format

#### Channel Access Issues

- **"channel_not_found"**: User doesn't have access to channel
- **"Write access restricted"**: Trying to post to unauthorized channel
- **"is_archived"**: Channel has been archived

#### Module Loading Issues

- **ESM/CommonJS errors**: Project uses ES modules - ensure all imports use `.js` extensions
- **"require() not found"**: Indicates CommonJS usage in ESM context - update to import statements
- **Build errors**: Run `npm run build` after making changes to TypeScript filesive analysis ### Auto Test Analysis Contract

- **Test Suites**: Always reports status for all three suites:
  - Cypress (general) – bot_id: B067SLP8AR5
  - Cypress (unverified) – bot_id: B067SMD5MAT
  - Playwright (Jenkins) – bot_id: B052372DK4H (fallback by username/text if missing)
- **Time Window Logic**:
  - Monday: fetch Fri→Sun (inclusive); otherwise: previous day
  - Uses inclusive history to avoid boundary misses; per-suite latest is selected within the window
- **Enhanced Parsing and Detection**:
  - Blocks and attachments text are extracted and parsed
  - Playwright marked passed when "Success/PASSED/🟢/green" is present
  - Threads analyzed for: rerun success, not blocking, still failing, PR opened, revert
- **Improved Output Formatting**:
  - Passed tests show: "✅" followed by "All tests passed" on next line
  - Failed tests show detailed failure information with review status
  - Clear spacing between test result sections
- **Output**: Always shows all three suites with status and Slack permalink to parent messagetesting channels to determine release readiness
- **Enhanced Test Reporting**: Improved formatting with clear "All tests passed" messages for successful tests
- **Channel Communication**: Read from any channel, write only to authorized release channels
- **Auto Test Monitoring**: Detection and analysis of automated test results with thread review analysis
- **Blocking Issue Detection**: Identification of critical and blocking issues with JIRA ticket extraction
- **Secure Channel Access**: Restricted write permissions for controlled release communication
- **Modular Architecture**: Clean separation of concerns with dedicated services for analysis, formatting, and communication

## Authentication

### Overview

This server uses **XOXC/XOXD session-based authentication** instead of traditional bot tokens. This approach provides:

- **Real user session access** with full workspace permissions
- **No bot installation required** 
- **Access to private channels** and DMs
- **Simplified setup** for internal tools

### Authentication Method Details

#### XOXC Token (Session Cookie)
- **Purpose**: Primary authentication token representing an active user session
- **Format**: `xoxc-...` followed by a long alphanumeric string
- **Source**: Extracted from browser cookies when logged into Slack web
- **Security**: Acts as your personal session - treat as password

#### XOXD Token (Session Secret)
- **Purpose**: Secondary authentication parameter that pairs with XOXC
- **Format**: `xoxd-...` followed by a numeric string
- **Source**: Found in browser developer tools during Slack web requests
- **Security**: Required together with XOXC for complete authentication

### How to Extract Tokens

1. **Open Slack in your browser** and log in to your workspace
2. **Open Developer Tools** (F12 or right-click → Inspect)
3. **Go to Application tab** → Cookies → `https://app.slack.com`
4. **Find the `d` cookie** - this is your XOXD token (format: `xoxd-...`)
5. **Go to Network tab** and reload the page
6. **Look for any API request** to `api.slack.com`
7. **In the request headers**, find `Authorization: Bearer xoxc-...` - this is your XOXC token

### Environment Setup

Create a `.env` file in the project root:

```env
SLACK_XOXC_TOKEN=xoxc-your-token-here
SLACK_XOXD_TOKEN=xoxd-your-token-here
```

### Authentication Implementation

The server uses a simplified authentication approach in `simple-xoxc.ts`:

```typescript
export function createXOXCWebClient(xoxcToken: string, xoxdToken: string): WebClient {
  return new WebClient(xoxcToken, {
    headers: {
      Cookie: `d=${xoxdToken};`,
    },
  });
}
```

### Security Considerations

#### ⚠️ Important Security Notes

1. **Token Sensitivity**: XOXC/XOXD tokens are equivalent to your Slack password
2. **Session Expiration**: Tokens expire when you log out or session times out
3. **Personal Access**: Tokens grant access to everything you can see in Slack
4. **No Audit Trail**: Actions appear as if performed by the token owner
5. **Workspace Specific**: Tokens only work for the workspace they were extracted from

#### Best Practices

- **Rotate tokens regularly** (extract new ones periodically)
- **Use dedicated service accounts** when possible
- **Store tokens securely** (never commit to version control)
- **Monitor token usage** through Slack audit logs
- **Limit server access** to trusted systems only

#### Channel Write Restrictions

For security and process control, the server implements **strict write permissions**:

```typescript
// BUSINESS REQUIREMENT: Only allow posting to qa-release-status channel
const allowedChannels = ['qa-release-status', '#qa-release-status', 'C09BW9Y2HSN'];
```

**Why this restriction exists:**
- Prevents accidental posts to wrong channels
- Ensures release communication follows proper channels
- Maintains audit trail for release decisions
- Reduces risk of sensitive information leakage

## Usage

### Installation

```bash
npm install
npm run build
```

### Performance Tips

**Use Channel IDs for Better Performance:**
- Channel names like `#qa-release-status` require expensive API lookups
- Channel IDs like `C09BW9Y2HSN` resolve instantly
- For automated/repeated operations, prefer channel IDs

```javascript
// Slow: requires fetching all channels to resolve name
channel: "#qa-release-status"

// Fast: direct channel ID lookup
channel: "C09BW9Y2HSN"
```

### Available Tools

1. **get_release_status_overview** – Comprehensive release readiness analysis with formatted output
2. **get_auto_test_status** – Auto test results for 3 suites + thread review status with improved formatting
3. **get_blocking_issues** – Critical/blocking issue detection with JIRA ticket extraction
4. **get_channel_history** – Read messages from any channel with user resolution
5. **send_message** – Post messages (restricted to qa-release-status only)
6. **list_channels** – List workspace channels
7. **search_messages** – Search across workspace
8. **add_reaction** – Add emoji reactions
9. **get_thread_replies** – Read thread discussions
10. **get_message_details** – Fetch full message including blocks/attachments
11. **find_bot_messages** – Inspect bot messages and extracted text for debugging

## Architecture Notes (Auto Test Analysis)

- **Bot Detection**: Simplified and optimized bot detection using strict TEST_BOT_IDS mapping. No longer uses fuzzy username/text heuristics, improving speed and reducing false positives.
- **Thread Analysis**: Extracted to `services/thread-analyzer.ts` (ThreadAnalyzerService) which reads thread replies and produces structured results: failedTests[], statusNote, perTestStatus mapping and summary.
- **Report Formatting**: Handled by `services/test-report-formatter.ts` (TestReportFormatter). Renders Slack-friendly output with improved formatting:
  - ✅ All tests passed (for successful tests)
  - Clear multi-line formatting with proper spacing
  - Detailed failure information with review status
- **Main Orchestration**: `services/test-analyzer.ts` coordinates: finding bot messages, determining pass/fail status, requesting review context from ThreadAnalyzerService, and delegating formatting to TestReportFormatter.
- **Issue Detection**: `services/issue-detector.ts` handles blocking/critical issue detection and is used by the ReleaseAnalyzer.
- **ESM Compatibility**: Full ES modules support with clean imports and no CommonJS dependencies for better performance and compatibility.

### MCP Configuration

Add to your MCP settings (e.g., Claude Desktop):

```json
{
  "slack-release": {
    "command": "node",
    "args": ["/path/to/slack-mcp-server/dist/server.js"],
    "env": {
      "SLACK_XOXC_TOKEN": "xoxc-your-token",
      "SLACK_XOXD_TOKEN": "xoxd-your-token"
    }
  }
}
```

## Release Management Workflow

### Daily Release Check

1. **Analyze functional testing**: Check latest messages for test results
2. **Review auto tests**: Verify all automated tests have passed
3. **Scan for blockers**: Look for critical or blocking issues
4. **Generate status**: Create comprehensive release readiness report
5. **Post to qa-release-status**: Share decision with team

### Example Usage

```bash
# Get release status
echo '{"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": "get_release_status_overview", "arguments": {"channel": "functional-testing"}}}' | node dist/server.js

# Post status (only to qa-release-status)
echo '{"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": "send_message", "arguments": {"channel": "qa-release-status", "text": "🟢 Release approved - all tests passing"}}}' | node dist/server.js
```

## Troubleshooting

### Authentication Issues

- **"invalid_auth" error**: Token expired, extract new XOXC/XOXD
- **"missing_scope" error**: User lacks permissions for requested action
- **Network errors**: Check if Slack is accessible

### Token Extraction Problems

- **Can't find d cookie**: Clear browser cache and try again
- **XOXC not in headers**: Make sure you're logged in and making API requests
- **Tokens don't work**: Verify workspace and token format

### Channel Access Issues

- **"channel_not_found"**: User doesn't have access to channel
- **"Write access restricted"**: Trying to post to unauthorized channel
- **"is_archived"**: Channel has been archived

## Development

### Project Structure

```
src/
├── server.ts                # MCP server wiring and tool registry
├── auth/
│   └── slack-auth.ts        # XOXC/XOXD session auth bootstrap (SlackAuth)
├── clients/
│   └── slack-client.ts      # WebClient wrapper (history, replies, search, permalink)
├── handlers/
│   ├── messaging.ts         # Tools: send, list, history, search, reactions, get details
│   └── analysis.ts          # Tools: get_auto_test_status, get_blocking_issues, overview
├── services/
│   ├── issue-detector.ts    # Blocking/critical issue detection
│   ├── release-analyzer.ts  # Orchestrates test + issues into release overview
│   ├── test-analyzer.ts     # Auto test analysis (Cypress/Playwright) + threads
│   ├── thread-analyzer.ts   # Dedicated thread analysis and review status detection
│   └── test-report-formatter.ts # Test result formatting with improved output styling
├── utils/
│   ├── analyzers.ts         # Text analysis helpers (severity, details)
│   ├── date-utils.ts        # Monday/prev-day windows, lookback
│   ├── message-extractor.ts # Blocks/attachments extraction and parsing
│   └── resolvers.ts         # Channel/user resolve utilities
└── types/
    └── index.ts             # Shared types (SlackMessage, TestResult, etc.)
```

### Auto Test Analysis Contract

- Suites reported every time:
  - Cypress (general) – bot_id: B067SLP8AR5
  - Cypress (unverified) – bot_id: B067SMD5MAT
  - Playwright (Jenkins) – bot_id: B052372DK4H (fallback by username/text if missing)
- Time window logic:
  - Monday: fetch Fri→Sun (inclusive); otherwise: previous day
  - Uses inclusive history to avoid boundary misses; per-suite latest is selected within the window
- Parsing and detection:
  - Blocks and attachments text are extracted and parsed
  - Playwright marked passed when “Success/PASSED/🟢/green” is present
  - Threads analyzed for: rerun success, not blocking, still failing, PR opened, revert
- Output always shows all three suites with status and a Slack permalink to the parent message

### Debugging

- Auto test runs append a debug log under /tmp (e.g., /tmp/slack-debug-<ts>.log) with:
  - Date range used, relevant message counts, selected messages
  - Extracted text snippets and parsed fields
  - Thread analysis outcomes

### Building

```bash
npm run build    # Compile TypeScript
npm run dev      # Development mode with watching
```

### Testing

```bash
# Test authentication
node dist/server.js <<< '{"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": "list_channels", "arguments": {}}}'

# Test release analysis
node dist/server.js <<< '{"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": "get_release_status_overview", "arguments": {"channel": "functional-testing"}}}'
```

## License

Internal use only - Not for public distribution