# Slack MCP Server - Architecture

> For setup and usage, see [../README.md](../README.md). This doc covers architecture and modification patterns.

## Quick File Lookup

| I want to... | Go to |
|--------------|-------|
| Add/modify a tool | `src/server.ts` (definition) → `src/handlers/*.ts` (implementation) |
| Change blocking detection | `src/utils/patterns.ts` (patterns) or `src/services/issue-detection/` (pipeline) |
| Change test result analysis | `src/services/test-analyzer.ts` → `src/services/thread-analyzer.ts` |
| Change test result formatting | `src/services/test-report-formatter.ts` |
| Change test manager detection | `src/services/test-manager-update-detector.ts` |
| Change LLM classification | `src/services/issue-detection/services/llm-classifier.service.ts` |
| Change bot ID mappings | `src/services/test-bot-config.ts` (**ask first**) |
| Change write restrictions | `src/auth/slack-auth.ts` (**ask first**) |
| Add date utilities | `src/utils/date-utils.ts` |
| Add text analysis | `src/utils/analyzers.ts` (uses `src/utils/patterns.ts`) |
| See type definitions | `src/types/index.ts` |

## File Structure

```
src/
├── server.ts                 # MCP server entry point, tool routing
├── simple-xoxc.ts            # XOXC/XOXD WebClient factory (used by slack-auth.ts)
├── auth/
│   └── slack-auth.ts         # XOXC/XOXD auth, write access validation
├── clients/
│   ├── slack-client.ts       # Slack Web API wrapper
│   └── local-llm-client.ts   # Shared LLM client (OpenAI-compatible API)
├── handlers/
│   ├── base-handler.ts       # Common error handling patterns
│   ├── messaging.ts          # send, list, history, search, reactions
│   └── analysis.ts           # test status, blocking issues, release overview
├── services/
│   ├── issue-detector.ts     # Pipeline orchestrator for blocking issues
│   ├── issue-detection/      # Modular detection pipeline (see below)
│   ├── test-analyzer.ts      # Auto test result analysis
│   ├── thread-analyzer.ts    # Thread review status detection
│   ├── llm-test-classifier.service.ts  # LLM test status classification
│   ├── test-report-formatter.ts        # Test result formatting
│   ├── test-manager-update-detector.ts # Daily release decision detection
│   ├── test-bot-config.ts    # Bot ID mappings (DO NOT MODIFY)
│   └── release-analyzer.ts   # Release readiness decisions
├── utils/
│   ├── patterns.ts           # Central pattern registry (blocking, critical, etc.)
│   ├── analyzers.ts          # Text analysis helpers
│   ├── date-utils.ts         # Date handling, search windows
│   ├── message-extractor.ts  # Block/attachment parsing
│   └── resolvers.ts          # Channel/user resolution
└── types/
    └── index.ts              # TypeScript definitions
```

### Issue Detection Pipeline (`services/issue-detection/`)

```
issue-detection/
├── pipeline/
│   ├── issue-detection.pipeline.ts  # Orchestrates all services
│   └── pipeline-step.interface.ts   # Service contracts
├── services/
│   ├── slack-message.service.ts     # Slack API communication
│   ├── blocker-pattern.service.ts   # Text pattern matching
│   ├── context-analyzer.service.ts  # Thread analysis
│   ├── smart-deduplicator.service.ts # Duplicate detection
│   └── llm-classifier.service.ts    # LLM semantic classification
└── models/
    ├── service-interfaces.ts        # Type-safe service contracts
    └── detection-result.model.ts    # Result models
```

## Data Flows

### Issue Detection Pipeline

```
Raw Messages → SlackMessageService → BlockerPatternService → ContextAnalyzerService → SmartDeduplicatorService → LLMClassifierService → Issues
     ↓              ↓                       ↓                       ↓                       ↓                        ↓
  Search API    Message Filter        Text Patterns        Thread Analysis      Deduplicate (BEFORE LLM)    Semantic Filter
```

**Key:** Deduplication happens BEFORE LLM classification to minimize expensive LLM calls.

### Auto Test Analysis

```
Channel Messages → TestAnalyzer (find bot messages) → ThreadAnalyzer (review status) → TestReportFormatter → Output
                        ↓                                    ↓
                   Bot ID matching                    LLM classification (if available)
```

### Tool Request Flow

```
MCP Client → server.ts → Handler → Service → Client → Slack API
```

## Architecture Patterns

### Dependency Injection
```typescript
constructor(
  private issueDetector: IssueDetectorService,
  private testAnalyzer: TestAnalyzerService
) {}
```

### Singleton (Authentication)
```typescript
SlackAuth.getInstance().initializeClient();
```

### Pipeline (Issue Detection)
```typescript
// Services are composed, not inherited
const pipeline = new IssueDetectionPipeline(
  messageService, patternMatcher, contextAnalyzer, deduplicator, llmClassifier
);
```

## Key Services

### IssueDetectorService
- **Purpose**: Orchestrates blocking issue detection
- **Methods**: `findIssues()`, `formatIssuesReport()`
- **Uses**: Modular pipeline architecture internally

### TestAnalyzerService
- **Purpose**: Analyze Cypress/Playwright test results
- **Detection**: Bot messages by ID (see `test-bot-config.ts`)
- **Time window**: Monday looks back to Fri-Sun; otherwise previous day

### ThreadAnalyzerService
- **Purpose**: Determine if test failures have been reviewed
- **Output**: Per-test status (resolved, not_blocking, investigating, etc.)
- **LLM**: Uses LLMTestClassifierService when local LLM server available

### TestManagerUpdateDetector
- **Purpose**: Find test manager's daily release decision
- **Message types**: "Frontend release update", "Frontend release pipeline aborted"
- **Decisions**: release, start_hotfixing, postponed, aborted, unknown

### LLM Classifiers
Both use shared `LocalLLMClient` (OpenAI-compatible API, works with LM Studio/Ollama):
- **LLMClassifierService**: Blocker classification (is this a release blocker?)
- **LLMTestClassifierService**: Test status classification (is this failure resolved?)

## Critical Constraints (DO NOT MODIFY)

| Constraint | Location | Reason |
|------------|----------|--------|
| Write only to `#qa-release-status` | `slack-auth.ts:validateWriteAccess()` | Prevents accidental posts |
| Bot ID mappings | `test-bot-config.ts` | Business logic for test detection |
| Slack markdown format | All output | `*bold*` not `**bold**`, `<url\|text>` not `[text](url)` |
| ESM imports need `.js` | All TypeScript | Required for ES modules |

## Modifying the Codebase

### Adding a New Tool

1. **Define tool** in `server.ts`:
```typescript
{
  name: 'my_tool',
  description: 'Does something',
  inputSchema: { type: 'object', properties: {...}, required: [...] }
}
```

2. **Add route** in `server.ts` switch:
```typescript
case 'my_tool':
  return await this.handler.myTool(toolArgs);
```

3. **Implement** in handler file:
```typescript
async myTool(args: ToolArgs) {
  this.validateRequired(args, ['param1']);
  // implementation
  return this.formatResponse(result);
}
```

### Adding Detection Patterns

1. **Add patterns** to `utils/patterns.ts`:
```typescript
export const MY_PATTERNS = {
  positive: [/my-pattern/i],
  negative: [/not-my-pattern/i]
};
```

2. **Use in analyzer** or pattern service:
```typescript
import { MY_PATTERNS } from '../utils/patterns.js';
const matches = MY_PATTERNS.positive.some(p => p.test(text));
```

### Adding a Pipeline Service

1. **Define interface** in `models/service-interfaces.ts`:
```typescript
export interface IMyService {
  process(data: Input): Promise<Output>;
}
```

2. **Implement service** in `services/`:
```typescript
export class MyService implements IMyService {
  async process(data: Input): Promise<Output> { ... }
}
```

3. **Inject into pipeline** in `issue-detection.pipeline.ts`

### Working with LLM Classification

```bash
# Setup (one-time) - using LM Studio
# 1. Install LM Studio from https://lmstudio.ai
# 2. Download a Qwen3-30B-A3B MLX model
# 3. Start the server:
lms server start

# Verify
curl http://localhost:1234/v1/models
```

```typescript
// Check availability
if (await classifier.isAvailable()) {
  const result = await classifier.classifyMessage(message, context);
  console.log(`${result.isBlocker} (${result.confidence}%): ${result.reasoning}`);
}

// Disable in tests
pipeline.setLLMClassification(false);
```

## Business Logic

### Release Decision Factors
1. **Blocking Issues**: "blocker", "blocking", "release blocker" keywords
2. **Critical Issues**: "critical", "urgent" keywords
3. **Auto Tests**: Cypress (General/Unverified) and Playwright results
4. **Review Status**: Whether failures have been manually reviewed
5. **Test Manager Decision**: Daily release/hotfix/postpone decision

### Issue Detection Patterns
- **JIRA Tickets**: `JIRA_TICKET_PATTERN` from `patterns.ts`
- **Implicit Blocking**: "prio: blocker" in thread replies
- **Explicit Lists**: "Blockers: • TICKET-123"
- **Resolution**: "resolved", "fixed", "deployed" keywords
- **UI Block Guard**: Filters "add block dialog", "code block" false positives
- **Ad-blocker Guard**: Ignores ad-blocker mentions without release context

### Test Bot IDs (from test-bot-config.ts)
- Cypress General: `B067SLP8AR5`
- Cypress Unverified: `B067SMD5MAT`
- Playwright (Jenkins): `B052372DK4H`

## Debugging

### Debug Logs

**Auto test runs** write to `/tmp/slack-debug-<ts>.log`:
- Date range used
- Message counts
- Selected messages
- Thread analysis outcomes

**LLM classification** (when `DEBUG_LLM=true`) writes to `/tmp/llm-debug.log`:
- Failed tests being classified
- Thread content with markers (`[RESOLUTION SIGNAL]`, `[ASSIGNED TO: test]`)
- Raw LLM response with status and reasoning per test

Enable via `.vscode/mcp.json`:
```json
"env": { "DEBUG_LLM": "true" }
```

### Common Issues

| Issue | Solution |
|-------|----------|
| LLM timeout in tests | `pipeline.setLLMClassification(false)` |
| LM Studio not starting | Check `logs/lms-cron.log` or run `lms server start` |
| ESM import errors | Ensure `.js` extension on imports |
| VSCode using old code | Restart VSCode after rebuild |
