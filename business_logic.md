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

**Logic**:
- Find bot messages with test results (~16:30 CET)
- Parse test run results (Cypress unverified, general, Playwright)
- Check thread replies for manual verification of failed tests
- Determine if failures are release-blocking

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

### Bot Detection
- Auto test bots (need to identify actual bot names)
- Result posting patterns

### Issue Severity
- **Blocking**: "blocker", "blocking", "release blocker", "blocks release"
- **Critical**: "critical", "urgent", "high priority", "must fix"

### Ticket Patterns
- JIRA tickets: `[A-Z]+-\d+` (e.g., PROJ-123)
- Links to tickets

### Test Result Patterns
- Success indicators: "passed", "green", "✅", "success"
- Failure indicators: "failed", "red", "❌", "error", "failure"
- Pending: "running", "in progress", "pending"

## Time Zone Considerations
- All times in CET/CEST
- Handle timezone conversion for date filtering
- Consider Philippines timezone for manual testing timing