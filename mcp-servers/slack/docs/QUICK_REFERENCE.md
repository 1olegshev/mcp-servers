# Quick Reference - Common Operations

## 🚀 Quick Start Commands

```bash
# Build the project
npm run build

# Start the server
npm start

# Development with auto-rebuild
npm run dev

# Test a tool (example)
echo '{"jsonrpc": "2.0", "id": 1, "method": "tools/list"}' | node dist/server.js
```

## 🤖 LLM Classification Setup (Ollama + Qwen3)

```bash
# Install Ollama (macOS)
brew install ollama

# Pull the Qwen3 14B model (~9GB download)
ollama pull qwen3:14b

# Start Ollama server (usually auto-starts on macOS)
ollama serve

# Check if Ollama is running
curl http://localhost:11434/api/tags

# Test LLM classification manually
ollama run qwen3:14b "Is 'PROJ-123 is blocking the release' a release blocker? Answer as JSON."
```

**Note**: The cron job (`scripts/cron-release-wrapper.sh`) automatically starts Ollama when your Mac wakes, waits for it to be ready, and stops it after the job completes.

## 🔧 File Modification Quick Reference

### ➕ Adding a New Tool

**1. Tool Definition** (`server.ts`)
```typescript
// Add to tools array in setupHandlers()
{
  name: 'my_new_tool',
  description: 'Does something useful',
  inputSchema: {
    type: 'object',
    properties: {
      param1: { type: 'string', description: 'Required parameter' },
      param2: { type: 'number', description: 'Optional parameter', default: 10 }
    },
    required: ['param1']
  }
}
```

**2. Route Handler** (`server.ts`)
```typescript
// Add to switch statement in CallToolRequestSchema
case 'my_new_tool':
  return await this.messagingHandler.myNewTool(toolArgs);
```

**3. Implementation** (appropriate handler file)
```typescript
async myNewTool(args: ToolArgs) {
  this.validateRequired(args, ['param1']);
  
  try {
    // Your logic here
    const result = await this.slackClient.someOperation(args.param1);
    return this.formatResponse(`Operation completed: ${result}`);
  } catch (error) {
    this.handleError(error, 'execute my new tool');
  }
}
```

### 🔍 Adding Text Analysis

**1. Analyzer Function** (`utils/analyzers.ts`)
```typescript
static analyzeMyPattern(text: string): { found: boolean; data: string[] } {
  const pattern = /my-pattern-(\w+)/g;
  const matches = [...text.matchAll(pattern)];
  return {
    found: matches.length > 0,
    data: matches.map(m => m[1])
  };
}
```

**2. Use in Service**
```typescript
const analysis = TextAnalyzer.analyzeMyPattern(message.text);
if (analysis.found) {
  // Process the findings
}
```

### 🏢 Adding a New Service

#### **Option 1: Traditional Service** (`services/my-service.ts`)
```typescript
import { SlackClient } from '../clients/slack-client.js';

export class MyService {
  constructor(private slackClient: SlackClient) {}

  async doSomething(input: string): Promise<string> {
    // Business logic here
    const messages = await this.slackClient.getChannelHistory(input);
    return `Processed ${messages.length} messages`;
  }
}
```

#### **Option 2: Modular Pipeline Service** (`services/issue-detection/services/my-pipeline-service.ts`)
```typescript
import { IMyService } from '../models/service-interfaces.js';

export class MyPipelineService implements IMyService {
  constructor() {} // No dependencies for pure logic services

  async processData(data: MyData): Promise<MyResult> {
    // Pure business logic, easily testable
    return this.transformData(data);
  }

  private transformData(data: MyData): MyResult {
    // Implementation
  }
}
```

**Integration:**
```typescript
// In issue-detection.pipeline.ts
constructor(
  private messageService: ISlackMessageService,
  private patternMatcher: IPatternMatcher,
  private contextAnalyzer: IContextAnalyzer,
  private deduplicator: IDeduplicator,
  private myService: IMyService // Add your service
) {}
```

### 📋 Adding Test Result Formatting

**1. Formatter Service** (`services/my-formatter.ts`)
```typescript
export class MyFormatter {
  format(results: Result[]): string {
    let output = `📊 My Results:\n\n`;
    
    for (const result of results) {
      if (result.status === 'passed') {
        output += `• *${result.name}*: ✅\n`;
        output += `  All tests passed\n\n`;
      } else if (result.status === 'failed') {
        output += `• *${result.name}*: ❌\n`;
        output += `  Details: ${result.details}\n\n`;
      }
    }
    
    return output;
  }
}
```

**2. Multi-line Formatting Pattern**
```typescript
// ✅ Do: Clear multi-line formatting
output += `• *Test Suite*: ✅\n`;
output += `  All tests passed\n\n`;

// ❌ Avoid: Single line with too much info
output += `• *Test Suite*: ✅ All tests passed\n`;
```

### 🎛️ Adding Error Handling

**1. Custom Error** (`handlers/base-handler.ts`)
```typescript
protected validateBusinessRule(condition: boolean, message: string): void {
  if (!condition) {
    throw new McpError(ErrorCode.InvalidParams, message);
  }
}
```

**2. Service-Level Error**
```typescript
try {
  const result = await this.slackClient.someOperation();
  if (!result.ok) {
    throw new Error(`Slack API error: ${result.error}`);
  }
  return result;
} catch (error) {
  throw new McpError(
    ErrorCode.InternalError,
    `Service operation failed: ${error.message}`
  );
}
```

**3. ESM Module Errors** (See ESM troubleshooting section below)

## 📋 Common Patterns

### 🔗 Channel/User Resolution
```typescript
// Always resolve channels/users through SlackClient
const conversationId = await this.slackClient.resolveConversation(args.channel);

// Supports: 'C123456', '#general', '@username', 'U123456'
```

### 📅 Date Handling
```typescript
import { DateUtils } from '../utils/date-utils.js';

// Get date range for analysis
const { oldest, latest } = DateUtils.getDateRange(args.date);

// Format timestamps for display
const readable = DateUtils.formatTimestamp(message.ts);
```

### 🕵️ Message Analysis
```typescript
import { TextAnalyzer } from '../utils/analyzers.js';

// Extract JIRA tickets
const tickets = TextAnalyzer.extractTickets(message.text);

// Check if message is from a bot
const isBot = TextAnalyzer.isTestBot(message);

// Analyze issue severity
const { isBlocking, isCritical } = TextAnalyzer.analyzeIssueSeverity(message.text);

// NEW: Guard against UI/technical "block" terminology
if (TextAnalyzer.hasUIBlockContext(message.text)) {
  // skip blocking classification
}

// NEW: Ignore ad-blocker mentions unless tied to release context
if (TextAnalyzer.isAdBlockerNonReleaseContext(message.text)) {
  // skip blocking classification
}
```

### 🤖 LLM Classification
```typescript
import { LLMClassifierService } from '../services/issue-detection/services/llm-classifier.service.js';

// Create classifier (uses Ollama with Qwen3 14B)
const classifier = new LLMClassifierService();

// Check if Ollama is available
if (await classifier.isAvailable()) {
  // Classify a message
  const result = await classifier.classifyMessage(message, threadContext);

  if (result.isBlocker) {
    console.log(`Blocker confirmed (${result.confidence}%): ${result.reasoning}`);
  } else {
    console.log(`Not a blocker: ${result.reasoning}`);
  }
}

// In pipeline tests, disable LLM to avoid timeouts
pipeline.setLLMClassification(false);
```

### 🧵 Thread Detection & Issue Analysis
```typescript
import { IssueDetectorService } from '../services/issue-detector.js';

// Use the modular pipeline architecture (backward compatible)
const issueDetector = new IssueDetectorService(slackClient);

// Analyze issues with advanced thread support
const issues = await issueDetector.findIssues(channel, date, 'both');
// Returns: blocking, critical, and blocking_resolved issues
// Pipeline: Messages → Parse → Analyze → Deduplicate → LLM Classify → Results
// Features: Smart deduplication, implicit blocking detection, thread analysis, LLM filtering
// Thread analyzer per-test statuses include (updated):
// ✅ resolved/not blocking; 🔄 assigned/rerun/fix; ℹ️ acknowledged/explained/needs repro; 🔍 root cause; ⚠️ flakey; 🛠️ test update required; ❌ still failing
// Section summary shows breakdowns when not resolved, e.g. "🔄 assigned 2, rerun 1 • ℹ️ ack 1"

// Pipeline components (for advanced usage):
import { SlackMessageService } from '../services/issue-detection/services/slack-message.service.js';
import { BlockerPatternService } from '../services/issue-detection/services/blocker-pattern.service.js';
import { ContextAnalyzerService } from '../services/issue-detection/services/context-analyzer.service.js';
```

### 🔐 Authentication Checks
```typescript
import { SlackAuth } from '../auth/slack-auth.js';

// Validate write access (throws if not allowed)
SlackAuth.getInstance().validateWriteAccess(channel);

// Get authenticated client
const client = SlackAuth.getInstance().getClient();
```

## 🎯 Testing Patterns

### 🧪 Service Testing
```typescript
// Mock SlackClient for testing
const mockSlackClient = {
  getChannelHistory: jest.fn().mockResolvedValue([/* mock messages */]),
  sendMessage: jest.fn().mockResolvedValue({ ts: '1234567890.123' })
};

const service = new MyService(mockSlackClient as any);
const result = await service.doSomething('test-input');
expect(result).toBe('expected-output');
```

### 🎛️ Handler Testing
```typescript
// Test handler with mock args
const handler = new MyHandler(mockSlackClient);
const result = await handler.myTool({ param1: 'test' });
expect(result.content[0].text).toContain('expected result');
```

## 🚨 Common Gotchas

### ❌ Don't
```typescript
// Don't bypass authentication
const client = new WebClient(token);

// Don't ignore error handling
const result = await this.slackClient.someOperation(); // Missing try/catch

// Don't hardcode channel IDs
await this.slackClient.sendMessage('C1234567', text);

// Don't use standard markdown in Slack output
output += `**BLOCKING ISSUES**`; // Wrong! Uses standard markdown
output += `[TICKET-123](https://url.com)`; // Wrong! Standard link format
output += `# Header`; // Wrong! Slack doesn't support headers
```

### ✅ Do
```typescript
// Use authenticated client
const client = SlackAuth.getInstance().getClient();

// Handle errors properly
try {
  const result = await this.slackClient.someOperation();
  return this.formatResponse(result);
} catch (error) {
  this.handleError(error, 'operation description');
}

// Resolve channels dynamically
const channel = await this.slackClient.resolveConversation(args.channel);

// ✅ Use Slack markdown formatting (see Slack Formatting section below)
output += `*BLOCKING ISSUES*`; // Correct! Single asterisks for bold
output += `<https://url.com|TICKET-123>`; // Correct! Slack link format
output += `*Header*`; // Correct! Bold text instead of headers
```

## 🎨 Slack Formatting (CRITICAL)

### 🚨 **Use Slack Markdown, NOT Standard Markdown**
```typescript
// ✅ CORRECT (Slack format)
output += `*Bold Text*`;                    // Single asterisks
output += `<https://url.com|Link Text>`;    // Angle brackets
output += `*Header Text*`;                  // Bold for headers

// ❌ WRONG (Standard markdown - breaks in Slack)
output += `**Bold Text**`;                  // Double asterisks
output += `[Link Text](https://url.com)`;   // Square brackets  
output += `# Header`;                       // Hash headers
```

### 📋 **Common Patterns**
```typescript
// Issue reports
output += `🚨 *BLOCKING ISSUES*: Issue description\n`;
output += `🎫 *Tickets*: <${url}|TICKET-123>\n`;
output += `🔗 <${permalink}|Open thread>\n`;
```

## 📈 Performance Tips

### ⚡ Optimize Message Queries
```typescript
// Limit message history for performance
const messages = await this.slackClient.getChannelHistoryForDateRange(
  channel, oldest, latest, 100 // Limit to 100 messages
);

// Use date ranges instead of scanning all history
const { oldest, latest } = DateUtils.getDateRange(targetDate);
```

### 💾 Cache Expensive Operations
```typescript
// User lookups are cached in SlackResolver
const userMap = await this.slackClient.buildUserMap(); // Cached

// Thread analysis - check if thread exists before fetching
if (message.thread_ts || (message.reply_count || 0) > 0) {
  const replies = await this.slackClient.getThreadReplies(channel, message.ts);
}
```

This quick reference provides the most common patterns you'll need when working with this codebase!

## 🔧 Troubleshooting Quick Fixes

### LLM Classification Issues
```bash
# Check if Ollama is running
curl http://localhost:11434/api/tags
# Should return JSON with available models

# Start Ollama manually
ollama serve

# Check if qwen3:14b is installed
ollama list
# Should show qwen3:14b

# Re-pull model if corrupted
ollama pull qwen3:14b

# Test LLM directly
ollama run qwen3:14b "Hello, respond with just 'OK'"

# Check cron log for Ollama startup issues
tail -50 logs/cron-auto-release.log | grep -i ollama
```

**Common Issues**:
- **Timeouts in tests**: Call `pipeline.setLLMClassification(false)` in test setup
- **Empty responses**: LLM thinking tokens are handled automatically
- **Ollama not starting on cron**: Check `logs/ollama-cron.log` for errors

### ESM Module Issues
```bash
# Error: "require() not found" or "import not recognized"
npm run build  # Always rebuild after TypeScript changes

# Check import paths have .js extensions
grep -r "from '\./.*[^.]'" src/  # Find imports missing .js

# Verify no CommonJS usage
grep -r "require(" src/  # Should return no results
```

### Test Result Formatting Issues
```typescript
// To test formatting changes:
npm run build
echo '{"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": "get_auto_test_status", "arguments": {"date": "2025-09-03"}}}' | node dist/server.js

// Or test with coordinator posting to Slack:
echo '{"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": "mcp_release-coord_get_comprehensive_release_overview", "arguments": {"date": "2025-09-03", "postToSlack": true}}}' | node dist/server.js
```

### Performance Debugging
```typescript
// Check message limits and date ranges
const { oldest, latest } = DateUtils.getDateRange('2025-09-03');
console.log(`Scanning ${oldest} to ${latest}`);

// Monitor API calls in logs
const messages = await this.slackClient.getChannelHistoryForDateRange(
  channel, oldest, latest, 50 // Reduce limit for testing
);
```