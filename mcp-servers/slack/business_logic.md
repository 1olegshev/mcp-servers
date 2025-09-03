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
🔬 Latest Test Results:
• Cypress (general): ✅
  All tests passed

• Cypress (unverified): ❌
  • auth2_register-south-korean_spec — 🔄 rerun in progress
  └─ Manual rerun successful ✅

• Playwright: ✅
  All tests passed

⚠️ AUTO TEST STATUS: ATTENTION REQUIRED
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

### ✅ COMPLETED (September 3, 2025)

**Core Infrastructure:**
- ✅ Thread reply reading capability (`get_thread_replies`)
- ✅ Date filtering utilities (DateUtils with CET timezone logic)
- ✅ Bot detection patterns (Cypress B067SLP8AR5, B067SMD5MAT, Playwright B052372DK4H)

**Enhanced Analysis:**
- ✅ `get_auto_test_status` with Block Kit parsing and improved formatting
- ✅ Message extraction utilities (extractAllMessageText, parseTestResultsFromText)
- ✅ Thread analysis for review status detection (ThreadAnalyzerService)
- ✅ Bot message detection and analysis tools (`find_bot_messages`, `get_message_details`)
- ✅ Test result formatting with enhanced output (TestReportFormatter)

**Major Features Completed:**
- ✅ `get_blocking_issues` - Extract JIRA tickets and severity analysis
- ✅ `get_release_status_overview` - Main aggregator tool with comprehensive reporting
- ✅ Playwright test detection and analysis
- ✅ Release coordination with MCP server integration

**Recent Improvements (September 2025):**
- ✅ Enhanced test result formatting ("All tests passed" with multi-line display)
- ✅ Improved architecture with dedicated ThreadAnalyzerService and TestReportFormatter
- ✅ ESM module compatibility fixes and debugging improvements
- ✅ Clean separation of analysis, formatting, and coordination concerns

**Validation:**
- ✅ Tested with real Cypress bot messages (multiple test runs)
- ✅ Verified thread analysis (manual rerun conclusions, fix status)
- ✅ Posted accurate status to #qa-release-status channel
- ✅ Full integration testing with release coordinator
- ✅ Comprehensive documentation updates

### 🎯 CURRENT STATUS: PRODUCTION READY

All major tools and features are implemented and tested. The system provides:
- Comprehensive release readiness analysis
- Enhanced test result formatting and presentation
- Robust error handling and ESM compatibility
- Clean, maintainable architecture with proper separation of concerns