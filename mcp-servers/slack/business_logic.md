# Release Status Analysis - Business Logic

## Overview
Enhanced Slack MCP server to analyze daily release readiness based on #functional-testing channel activity.

## Timeline Context
- **16:20 CET**: Daily builds ready
- **16:30 CET**: Auto tests complete (3 runs: Cypress unverified ~20-50, Cypress general 1100+, Playwright)
- **02:00 CET+1**: Manual testing starts (Philippines team)

## Core Question
**"Can we release today?"** - with detailed breakdown of blockers and uncertainties

## New Tools Design

### 1. `get_release_status_overview`
**Purpose**: Main aggregator - answers "Can we release?"
**Parameters**:
- `date` (optional): Target date (defaults to today)
- `channel`: Channel to analyze (defaults to "functional-testing")

**Output Structure**:
```
🚦 RELEASE STATUS: [READY/BLOCKED/UNCERTAIN]

📊 AUTO TESTS STATUS:
- Cypress Unverified: [PASSED/FAILED/PENDING]
- Cypress General: [PASSED/FAILED/PENDING] 
- Playwright: [PASSED/FAILED/PENDING]
- Review Status: [COMPLETE/PENDING/ISSUES]

🚨 BLOCKING ISSUES:
- [List of blocking tickets/issues]

⚠️ CRITICAL ISSUES:
- [List of critical tickets/issues]

🔍 MANUAL TESTING:
- Status: [NOT_STARTED/IN_PROGRESS/COMPLETED]
- Issues Found: [count]

📋 SUMMARY:
[Overall assessment and recommendation]
```

### 2. `get_auto_test_status`
**Purpose**: Detailed auto test analysis
**Parameters**:
- `date` (optional): Target date (defaults to today)
- `channel`: Channel to analyze

**CRITICAL BUSINESS LOGIC**:
- **Auto tests run on PREVIOUS date(s)** at ~16:30 CET
- **For today's release decision**: Look for LATEST/CLOSEST test runs from previous date(s)
- **Must find complete set**: 2 Cypress runs (unverified + general) + 1 Playwright run

**Enhanced Implementation**:
- **Bot Detection**: Cypress bot IDs (B067SLP8AR5, B067SMD5MAT), Jenkins patterns
- **Block Kit Parsing**: Extract test details from Slack's complex message structure
- **Thread Analysis**: Check replies for manual review conclusions
- **Status Priority**: "Failed run" overrides individual test "passed" counts
- **Review Patterns**: "passed after rerun", "fix ready", "not blocking release"

**Output Example**:
```
🔬 Latest Test Results (Aug 26, ~16:30 CET):
• **Cypress (frontend-qa)**: ❌ Run #1022
  └─ Failed tests: workspace_expired-org-downgrade-individual-subscription_spec.ts, ...
  └─ ✅ **RESOLVED**: Fix ready, waiting to merge 🙌

✅ **AUTO TEST STATUS: RESOLVED - NOT BLOCKING**
```

### 3. `get_blocking_issues`
**Purpose**: Extract blocking/critical issues
**Parameters**:
- `date` (optional): Target date
- `channel`: Channel to analyze
- `severity`: ["blocking", "critical", "both"] (default: "both")

**Logic**:
- Search for keywords: "blocker", "blocking", "critical", "urgent"
- Extract ticket numbers (JIRA format: PROJ-123)
- Analyze thread context for confirmation
- Categorize by severity

### 4. `get_thread_replies`
**Purpose**: Enhanced thread reading (utility tool)
**Parameters**:
- `channel`: Channel ID
- `thread_ts`: Thread timestamp
- `limit`: Max replies to fetch

**Adds missing capability to read thread replies for analysis**

## Implementation Strategy

### Phase 1: Core Infrastructure
1. Add thread reply reading capability
2. Implement date filtering utilities
3. Add pattern matching for bots, tickets, keywords

### Phase 2: Analysis Tools
1. Implement `get_blocking_issues`
2. Implement `get_auto_test_status` 
3. Add text analysis utilities

### Phase 3: Aggregation
1. Implement `get_release_status_overview`
2. Add intelligent status determination logic
3. Format comprehensive output

### Phase 4: Testing & Refinement
1. Test with real channel data
2. Refine keyword patterns
3. Optimize performance

## Keywords & Patterns

### Bot Detection (IMPLEMENTED)
- **Cypress Bots**: B067SLP8AR5 (frontend-qa), B067SMD5MAT (frontend-qa-unverified)
- **Jenkins Patterns**: "kahoot-frontend-player-qa-playwright"
- **Test Result Patterns**: "run #\d+", "failed run", "test results:", "specs for review"

### Block Kit Message Parsing (IMPLEMENTED)
- **Extract from blocks**: rich_text sections, context elements, mrkdwn text
- **Extract from attachments**: title, text, fields, footer content
- **Failed Test Extraction**: Pattern matching for *_spec.ts, *.test.ts files

### Review Analysis Patterns (IMPLEMENTED)
- **Resolved**: "manual rerun passed", "fix ready", "passed after rerun", "not blocking"
- **Under Investigation**: "investigating", "will look", "checking"
- **Still Failing**: "still fail", "rerun failed", "not fixed"
- **Release Impact**: "not blocking release", "just the test spec"

### Issue Severity
- **Blocking**: "blocker", "blocking", "release blocker", "blocks release"
- **Critical**: "critical", "urgent", "high priority", "must fix"

### Ticket Patterns
- JIRA tickets: `[A-Z]+-\d+` (e.g., PROJ-123)
- Links to tickets

### Test Result Patterns (ENHANCED)
- **Success indicators**: "passed run", "green", "✅", "success" (but not when "failed run" present)
- **Failure indicators**: "failed run", "failed build", "❌", "error" (prioritized)
- **Pending**: "running", "in progress", "pending"

## Time Zone Considerations
- **Auto tests**: Previous day ~16:30 CET 
- **Release decision**: Current day (uses previous day's test results)
- **Manual testing**: 02:00 CET+1 (Philippines team)
- **Date Range Logic**: Monday looks back to Friday, others to previous day

## Implementation Status

### ✅ COMPLETED (August 27, 2025)

**Core Infrastructure:**
- ✅ Thread reply reading capability (`get_thread_replies`)
- ✅ Date filtering utilities (DateUtils with CET timezone logic)
- ✅ Bot detection patterns (Cypress B067SLP8AR5, B067SMD5MAT)

**Enhanced Analysis:**
- ✅ `get_auto_test_status` with Block Kit parsing
- ✅ Message extraction utilities (extractAllMessageText, parseTestResultsFromText)
- ✅ Thread analysis for review status detection
- ✅ Bot message detection and analysis tools (`find_bot_messages`, `get_message_details`)

**Validation:**
- ✅ Tested with real Cypress bot messages (Run #1022, #964)
- ✅ Verified thread analysis (manual rerun conclusions, fix status)
- ✅ Posted accurate status to #qa-release-status channel

### 🔄 NEXT STEPS

**Missing Tools:**
- ⏳ `get_blocking_issues` - Extract JIRA tickets and severity
- ⏳ `get_release_status_overview` - Main aggregator tool
- ⏳ Playwright test detection (no samples found yet)

**Enhancement Needed:**
- ⏳ Improve date range logic to handle weekends/holidays
- ⏳ Add manual testing status detection (Philippines team, 02:00 CET+1)
- ⏳ Integrate JIRA MCP for ticket status verification