# Slack MCP Server - AI Agent Documentation

## 🎯 Project Overview

This is a **Model Context Protocol (MCP) server** that provides Slack integration for release management and QA coordination. The project follows a **clean, modular architecture** with proper separation of concerns.

### 🎪 Core Purpose
- **Release Management**: Analyze release readiness from Slack channels
- **QA Coordination**: Monitor test results and blocking issues
- **Communication**: Send messages and interact with Slack workspace

## 📁 Architecture & File Structure

```
src/
├── server.ts                 # 🚀 Main orchestrator (50 lines)
├── auth/
│   └── slack-auth.ts        # 🔐 Authentication management
├── clients/
│   └── slack-client.ts      # 🌐 Slack API wrapper
├── services/                # 🏢 Business logic layer
│   ├── issue-detector.ts    # 🔍 Main service (pipeline orchestrator)
│   ├── issue-detection/     # 🏗️ Modular issue detection pipeline
│   │   ├── pipeline/
│   │   │   ├── issue-detection.pipeline.ts    # 📊 Pipeline orchestrator
│   │   │   └── pipeline-step.interface.ts      # 🎯 Pipeline contracts
│   │   ├── services/
│   │   │   ├── slack-message.service.ts       # 🌐 Slack API communication
│   │   │   ├── blocker-pattern.service.ts     # 🕵️ Text pattern matching
│   │   │   ├── context-analyzer.service.ts    # 🧵 Thread analysis & context
│   │   │   ├── smart-deduplicator.service.ts  # 🔄 Duplicate detection
│   │   │   └── llm-classifier.service.ts      # 🤖 LLM-based blocker classification (Ollama)
│   │   ├── models/
│   │   │   ├── service-interfaces.ts          # 📋 Service contracts
│   │   │   ├── ticket-context.model.ts        # 🎫 Ticket data models
│   │   │   ├── detection-config.model.ts      # ⚙️ Configuration models
│   │   │   └── detection-result.model.ts      # 📊 Result models
│   │   └── strategies/                         # 🎯 Extensible strategies
│   ├── test-analyzer.ts     # 🧪 Analyze auto test results
│   ├── thread-analyzer.ts   # 🧵 Dedicated thread review analysis
│   ├── test-report-formatter.ts # 📋 Format test results with improved styling
│   └── release-analyzer.ts  # 📊 Release status decisions
├── handlers/                # 🎛️ MCP tool handlers
│   ├── base-handler.ts      # 🏗️ Common patterns
│   ├── messaging.ts         # 💬 Communication tools
│   └── analysis.ts          # 📈 Analysis tools
├── utils/                   # 🛠️ Utility functions
│   ├── resolvers.ts         # 🔗 Channel/user resolution
│   ├── analyzers.ts         # 🕵️ Text analysis
│   ├── message-extractor.ts # 📄 Block/attachment parsing
│   └── date-utils.ts        # 📅 Date handling
└── types/
    └── index.ts             # 📋 TypeScript definitions
```

## 🏗️ Architecture Patterns

### 1. **Dependency Injection Pattern**
```typescript
// Services are injected into handlers
constructor(
  private issueDetector: IssueDetectorService,
  private testAnalyzer: TestAnalyzerService,
  private releaseAnalyzer: ReleaseAnalyzerService
) {}
```

### 2. **Singleton Pattern** (Authentication)
```typescript
// SlackAuth is a singleton to ensure single client instance
SlackAuth.getInstance().initializeClient();
```

### 3. **Strategy Pattern** (Error Handling)
```typescript
// BaseHandler provides consistent error handling
protected handleError(error: any, operation: string): never
```

### 4. **Factory Pattern** (Client Creation)
```typescript
// Different auth methods create appropriate clients
if (xoxc) return createXOXCWebClient(xoxc, xoxd);
if (legacyBot) return new WebClient(legacyBot);
```

## 🔧 Key Components Guide

### 🚀 **server.ts** - Main Orchestrator
- **Purpose**: Entry point, service initialization, tool routing
- **Key Methods**: `initializeServices()`, `setupHandlers()`
- **Dependencies**: All handlers and services
- **Size**: ~180 lines (clean and focused)

### 🔐 **auth/slack-auth.ts** - Authentication
- **Purpose**: Manage XOXC/XOXD session-based authentication
- **Pattern**: Singleton for global auth state
- **Key Methods**: `initializeClient()`, `validateWriteAccess()`
- **Security**: Restricts writes to qa-release-status channel only

### 🌐 **clients/slack-client.ts** - API Wrapper
- **Purpose**: Clean interface to Slack Web API
- **Key Methods**: `sendMessage()`, `getChannelHistory()`, `resolveConversation()`
- **Error Handling**: Converts Slack errors to MCP errors
- **Dependencies**: SlackAuth, SlackResolver

### 🏢 **Services Layer** (Business Logic)

#### 🔍 **issue-detector.ts** (Pipeline Orchestrator)
- **Purpose**: Main service that orchestrates the modular issue detection pipeline
- **Key Methods**: `findIssues()`, `formatIssuesReport()`
- **Architecture**: Uses dependency injection to coordinate specialized services
- **Backward Compatibility**: Maintains existing API while using new modular architecture
- **Size**: Reduced from 811 lines to 214 lines (73% reduction)

#### 🏗️ **issue-detection/** (Modular Pipeline)
- **Purpose**: Complete refactoring of issue detection into specialized, testable services
- **Architecture**: Pipeline pattern with clear separation of concerns
- **Benefits**: Improved maintainability, testability, and extensibility

##### 📊 **Pipeline Orchestrator**
- **File**: `pipeline/issue-detection.pipeline.ts`
- **Purpose**: Coordinates data flow between all services
- **Pattern**: Raw Messages → Parse → Analyze → Deduplicate → LLM Classify → Issues
- **Note**: Deduplication happens BEFORE LLM classification to minimize expensive LLM calls
- **Error Handling**: Comprehensive error aggregation and reporting

##### 🌐 **Slack Message Service**
- **File**: `services/slack-message.service.ts` (155 lines)
- **Purpose**: Pure API communication layer for Slack operations
- **Methods**: `findBlockerMessages()`, `getThreadContext()`
- **Features**: Search API integration, thread fetching, message filtering

##### 🕵️ **Blocker Pattern Service**
- **File**: `services/blocker-pattern.service.ts` (182 lines)
- **Purpose**: Text analysis and pattern matching for blocking/critical indicators
- **Methods**: `hasBlockingIndicators()`, `hasCriticalIndicators()`, `extractTickets()`
- **Features**: JIRA ticket extraction, regex compilation, keyword detection

##### 🧵 **Context Analyzer Service**
- **File**: `services/context-analyzer.service.ts` (279 lines)
- **Purpose**: Advanced thread analysis and context extraction
- **Methods**: `analyzeTicketInContext()`, `analyzeTickets()`
- **Features**: Thread-specific blocking analysis, implicit ticket detection, resolution tracking

##### 🔄 **Smart Deduplicator Service**
- **File**: `services/smart-deduplicator.service.ts` (218 lines)
- **Purpose**: Intelligent duplicate detection and prioritization
- **Methods**: `deduplicateWithPriority()`
- **Features**: Context-aware deduplication, thread vs list priority, ticket merging

##### 🤖 **LLM Classifier Service** (NEW)
- **File**: `services/llm-classifier.service.ts`
- **Purpose**: Semantic classification of messages as release blockers using local LLM
- **Methods**: `classifyMessage()`, `isAvailable()`, `buildPrompt()`, `parseResponse()`
- **LLM Backend**: Ollama with Qwen3 14B model (local, runs on Mac)
- **Features**:
  - Semantic understanding of blocker context (vs. regex-only)
  - Handles Qwen3 thinking tokens (`<think>...</think>`)
  - Returns confidence scores (0-100%) and reasoning
  - Graceful fallback to keyword matching when Ollama unavailable
  - Lazy initialization (only connects when first needed)
- **Classification Criteria**:
  - ✅ Blocker: "blocker", "release blocker", "hotfix needed", "no go for release"
  - ❌ Not Blocker: "Is this a blocker?", "answer blocks", "ad-blocker", "not blocking"

##### 📋 **Service Interfaces & Models**
- **File**: `models/service-interfaces.ts` (87 lines)
- **Purpose**: Type-safe contracts for all services
- **Includes**: `ISlackMessageService`, `IPatternMatcher`, `IContextAnalyzer`, `IDeduplicator`
- **Benefits**: Dependency injection support, compile-time type checking

#### 🧪 **test-analyzer.ts**  
- **Purpose**: Analyze automated test results and coordinate analysis pipeline
- **Key Methods**: `analyzeTestResults()`, orchestrates analysis workflow
- **Detection**: Bot message patterns, test status via bot IDs
- **Dependencies**: ThreadAnalyzerService, TestReportFormatter
- **Output**: Coordinates between detection, thread analysis, and formatting

#### 🧵 **thread-analyzer.ts** (NEW)
- **Purpose**: Dedicated thread review status analysis
- **Key Methods**: `checkForReview()`, `analyzeThreadReplies()`
- **Analysis**: Manual rerun results, blocking status, PR/revert mentions
- **Output**: Structured review summaries with per-test status
- **Per-test status categories (UPDATED)**:
  - ✅ resolved, ✅ not blocking
  - 🔄 assigned, 🔄 rerun in progress, 🔄 fix in progress
  - ℹ️ acknowledged, 🔍 root cause identified, ℹ️ explained
  - ℹ️ needs repro, ⚠️ flakey/env-specific, 🛠️ test update required (e.g., selector/button moved)
  - ❌ still failing, ♻️ revert planned/applied, 🔍 investigating
- **Section summary (UPDATED)**: Breaks down every status bucket (resolved, in-progress, informational, investigating, unclear) so unresolved items stay visible. Example: `✅ 2 resolved/not blocking • 🔄 assigned 1 • ❓ needs review 1`.

#### 📋 **test-report-formatter.ts** (NEW)
- **Purpose**: Format test results with improved styling and clarity
- **Key Methods**: `format()`, `getLatestByType()`
- **Features**: 
  - Multi-line formatting: "✅" on first line, "All tests passed" on second
  - Clear spacing between test sections
  - Detailed failure information with review context
- **Output**: Slack-friendly markdown with enhanced readability. Suites that have unresolved/unclear tests now surface a "Needs Review" status until every failure is explicitly cleared.

#### 📊 **release-analyzer.ts**
- **Purpose**: Generate comprehensive release readiness decisions
- **Key Methods**: `generateReleaseOverview()`
- **Logic**: Combines issue and test analysis for final recommendation
- **Output**: "Can we release today?" with detailed reasoning

### 🎛️ **Handlers Layer** (MCP Interface)

#### 🏗️ **base-handler.ts**
- **Purpose**: Common patterns for all handlers
- **Key Methods**: `validateRequired()`, `handleError()`, `formatResponse()`
- **Pattern**: Template method pattern for consistent behavior

#### 💬 **messaging.ts**
- **Tools**: `send_message`, `list_channels`, `get_channel_history`, `search_messages`, `add_reaction`, `get_thread_replies`
- **Validation**: Channel resolution, write access control
- **Features**: User resolution, message formatting

#### 📈 **analysis.ts**
- **Tools**: `get_blocking_issues`, `get_auto_test_status`, `get_release_status_overview`
- **Integration**: Orchestrates service calls
- **Output**: Formatted analysis reports

### 🛠️ **Utils Layer** (Shared Logic)

#### 🔗 **resolvers.ts**
- **Purpose**: Convert various Slack identifiers to conversation IDs
- **Supports**: Channel IDs, user IDs, @username, #channel-name
- **Caching**: User lookup caching for performance
- **Key Methods**: `resolveConversation()`, `buildUserMap()`

#### 🕵️ **analyzers.ts**
- **Purpose**: Text analysis and pattern detection
- **Key Methods**: `extractTickets()`, `analyzeIssueSeverity()`, `isTestBot()`
- **Patterns**: JIRA ticket extraction, severity keywords, bot detection

#### 📅 **date-utils.ts**
- **Purpose**: Date handling and timestamp conversion
- **Key Methods**: `getDateRange()`, `formatTimestamp()`, `getTodayDateString()`
- **Format**: Unix timestamp ↔ YYYY-MM-DD conversion

## 🔄 Data Flow

### 1. **Tool Request Flow**
```
MCP Client → server.ts → Handler → Service → Client → Slack API
```

### 2. **Authentication Flow**
```
Environment → SlackAuth → WebClient → API Requests
```

### 3. **Issue Detection Pipeline Flow**
```
Raw Messages → SlackMessageService → BlockerPatternService → ContextAnalyzerService → SmartDeduplicatorService → LLMClassifierService → Issues
       ↓              ↓                       ↓                       ↓                       ↓                        ↓                ↓
    Search API    Message Filtering      Text Patterns        Thread Analysis      Duplicate Removal      Semantic Filter      Final Report
```
**Note**: Deduplication happens BEFORE LLM classification to minimize expensive LLM calls (10 messages about same ticket = 1 LLM call, not 10).

### 4. **Detailed Pipeline Data Flow**
```
1. SlackMessageService.findBlockerMessages()
   → Search Slack API for blocker/blocking keywords
   → Filter out negative phrases
   → Return seed messages

2. BlockerPatternService.parseBlockerList()
   → Extract explicit blocker lists (e.g., "Blockers: • TICKET-123")
   → Parse ticket-thread pairs from structured messages

3. ContextAnalyzerService.analyzeTickets()
   → Analyze each ticket in thread context
   → Detect implicit blocking in thread replies
   → Track resolution status across conversation

4. SmartDeduplicatorService.deduplicateWithPriority()
   → Remove duplicate tickets
   → Prioritize thread context over list-only entries
   → Merge ticket information intelligently

5. LLMClassifierService.classifyMessage() (if Ollama available)
   → Semantically classify each deduplicated issue
   → Filter false positives (UI "blocks", questions, ad-blockers)
   → Return confidence scores and reasoning
   → Fallback to keyword matching if Ollama unavailable

6. IssueDetectionPipeline.detectIssues()
   → Orchestrate entire flow
   → Aggregate errors and results
   → Return structured issue analysis
```

## 🔧 How to Work with This Project (AI Agent Guide)

### ✅ **Adding New Tools**
1. **Define tool schema** in `server.ts` tool list
2. **Add route** in `CallToolRequestSchema` handler
3. **Create handler method** in appropriate handler file
4. **Add business logic** in service if needed

### ✅ **Adding New Analysis Features**
1. **Identify the appropriate service** in the pipeline:
   - **SlackMessageService**: For new Slack API operations
   - **BlockerPatternService**: For new text patterns or keywords
   - **ContextAnalyzerService**: For thread analysis or context extraction
   - **SmartDeduplicatorService**: For deduplication logic
2. **Update service interface** in `models/service-interfaces.ts`
3. **Implement the feature** in the appropriate service class
4. **Update the pipeline** in `pipeline/issue-detection.pipeline.ts` if needed
5. **Update handler** to use new service method
6. **Add tool definition** if exposing to MCP

### ✅ **Working with Test Result Formatting**
1. **Modify display logic** in `services/test-report-formatter.ts`
2. **Update status rendering** in `format()` method
3. **Test formatting** by running coordinator with `postToSlack: true`
4. **Consider spacing** and multi-line formatting for readability

### ✅ **Adding Thread Analysis Features**
1. **Extend thread-analyzer.ts** for new review patterns
2. **Update review detection** in `analyzeThreadReplies()`
3. **Add new status types** to `perTestStatus` mapping
4. **Update formatter** to display new status information

### ✅ **Working with LLM Classification**
1. **Prerequisites**: Install Ollama and pull model:
   ```bash
   brew install ollama
   ollama pull qwen3:14b
   ollama serve  # Start server (or it auto-starts on macOS)
   ```
2. **Testing LLM classification**: The classifier auto-detects Ollama availability
3. **Modifying classification logic**: Edit `services/llm-classifier.service.ts`
4. **Adjusting prompts**: Update `buildPrompt()` method for different classification criteria
5. **Adding new classification types**: Extend `ClassificationResult` interface
6. **Disabling LLM in tests**: Call `pipeline.setLLMClassification(false)` in test setup
7. **Cron job**: The wrapper script (`scripts/cron-release-wrapper.sh`) auto-starts Ollama when Mac wakes

### ✅ **Modifying Authentication**
- **File**: `auth/slack-auth.ts`
- **Singleton pattern**: Always use `getInstance()`
- **Write restrictions**: Modify `validateWriteAccess()`

### ✅ **Adding New Slack Operations**
- **File**: `clients/slack-client.ts`
- **Error handling**: Always wrap in try/catch with McpError
- **Resolution**: Use resolver for channel/user conversion

### ✅ **Common Modification Patterns**

#### Adding Text Analysis
```typescript
// 1. Add to analyzers.ts
static analyzeNewPattern(text: string): boolean {
  return text.includes('new-pattern');
}

// 2. Use in service
const hasPattern = TextAnalyzer.analyzeNewPattern(message.text);
```

#### Adding New Service
```typescript
// 1. Create service file
export class NewService {
  constructor(private slackClient: SlackClient) {}
  async doSomething(): Promise<Result> { /* logic */ }
}

// 2. Inject in server.ts
const newService = new NewService(slackClient);

// 3. For formatting services, consider TestReportFormatter pattern
export class NewFormatter {
  format(data: DataType[]): string {
    // Multi-line formatting with proper spacing
    let output = "📊 Header:\n\n";
    data.forEach(item => {
      output += `• ${item.name}: ✅\n`;
      output += `  Status details\n\n`;
    });
    return output;
  }
}
```

#### Adding Test Result Formatting
```typescript
// Update test-report-formatter.ts
if (test.status === 'passed') {
  output += `• *${suite}*: ✅\n`;
  output += `  All tests passed\n`;
} else if (test.status === 'custom') {
  output += `• *${suite}*: 🔄\n`;
  output += `  Custom status message\n`;
}
```

#### Adding New Tool
```typescript
// 1. Add tool definition in server.ts
{
  name: 'new_tool',
  description: 'Does something new',
  inputSchema: { /* schema */ }
}

// 2. Add route
case 'new_tool':
  return await this.handler.newTool(toolArgs);

// 3. Implement handler method
async newTool(args: ToolArgs) {
  // implementation
}
```

## 🚨 Critical Guidelines

### ⚠️ **Security**
- **Write access** is restricted to `qa-release-status` channel only
- **Authentication** uses XOXC/XOXD session tokens (not bot tokens)
- **Validation** always validate inputs in handlers

### ⚠️ **Slack Formatting (CRITICAL)**
- **Use Slack markdown syntax**: `*text*` for bold, NOT `**text**`
- **Use Slack link format**: `<url|text>` NOT `[text](url)`
- **See QUICK_REFERENCE.md**: Full formatting guide with examples

### ⚠️ **Error Handling**
- **Always** extend BaseHandler for consistent error patterns
- **Use** McpError for MCP-compatible error responses
- **Catch** Slack API errors and convert appropriately
- **ESM Modules**: See QUICK_REFERENCE.md for ESM troubleshooting

### ⚠️ **Performance**
- **Cache** user lookups in SlackResolver
- **Limit** message history queries (default 200 messages)
- **Paginate** large result sets
- **Optimize** formatter output by minimizing API calls

## 🎯 Business Logic Context

### 📊 **Release Decision Logic**
The system analyzes multiple factors to determine release readiness:

1. **Blocking Issues**: Any issue with "blocker", "blocking", "release blocker" keywords
2. **Critical Issues**: Issues with "critical", "urgent", "high priority" keywords
3. **Resolved Blockers**: Previously blocking issues that have been marked as resolved
4. **Auto Tests**: Cypress (Unverified/General) and Playwright test results
5. **Review Status**: Whether failed tests have been manually reviewed

### 🔍 **Issue Detection Patterns**
- **JIRA Tickets**: Pattern `/[A-Z]+-\d+/g`
- **Bot Detection**: Username/text contains automation keywords
- **Test Status**: Success/failure keywords and emoji patterns
- **Thread Detection**: Extracts thread context from permalinks when API doesn't provide thread_ts
- **Implicit Blocking Detection**: Recognizes "prio: blocker", "priority: blocker" in thread replies referencing parent ticket
- **Explicit Blocker Lists**: Detects tickets in structured lists like "Blockers for Monday: • TICKET-123 • TICKET-456"
- **Smart Deduplication**: Prevents duplicates while preserving thread context and links over list-only entries
- **Resolution Patterns**: Detects "resolved", "fixed", "ready", "deployed" keywords in threads
 - **UI "block" Exceptions**: Avoid false positives from UI/technical terms such as "add block dialog", "create block panel", "code block", "answer blocks", etc. Implemented via `TextAnalyzer.hasUIBlockContext()` and applied in both pattern and context analyzers.
 - **Ad-blocker Guard**: Mentions of "ad blocker/ad-blocker" are ignored unless a nearby release/deploy/prod context is present (`TextAnalyzer.isAdBlockerNonReleaseContext()`).
 - **LLM Classification (NEW)**: Two-layer detection system:
   1. **Regex layer**: Fast pattern matching catches obvious cases
   2. **LLM layer**: Semantic classification filters false positives using Qwen3 14B via local Ollama
   - Returns confidence scores and reasoning for transparency
   - Gracefully falls back to regex-only when Ollama unavailable

### 💬 **Channel Conventions**
- **Analysis Source**: `functional-testing` (default)
- **Write Destination**: `qa-release-status` (restricted)
- **Test Bots**: Identified by automation-related usernames

This documentation provides AI agents with the context needed to understand, modify, and extend the project effectively while maintaining its clean architecture and business logic integrity.