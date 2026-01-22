# Quick Reference - Code Snippets

> Pure copy-paste patterns. For architecture details, see [ARCHITECTURE.md](ARCHITECTURE.md).

## CLI Commands

```bash
# Build
npm run build

# Dev mode
npm run dev

# Test tools (from project root)
export $(grep -v '^#' .env | grep -v '^$' | xargs)
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | node mcp-servers/slack/dist/server.js 2>/dev/null | jq '.result.tools[].name'
```

## LLM Setup (Ollama)

```bash
brew install ollama
ollama pull qwen3:30b
ollama serve

# Verify
curl http://localhost:11434/api/tags
```

## Adding a Tool

```typescript
// 1. server.ts - tool definition
{
  name: 'my_tool',
  description: 'Does something',
  inputSchema: {
    type: 'object',
    properties: {
      param1: { type: 'string', description: 'Required param' },
      param2: { type: 'number', default: 10 }
    },
    required: ['param1']
  }
}

// 2. server.ts - route
case 'my_tool':
  return await this.handler.myTool(toolArgs);

// 3. handler file - implementation
async myTool(args: ToolArgs) {
  this.validateRequired(args, ['param1']);
  try {
    const result = await this.slackClient.someOperation(args.param1);
    return this.formatResponse(`Done: ${result}`);
  } catch (error) {
    this.handleError(error, 'my tool operation');
  }
}
```

## Adding a Service

```typescript
// services/my-service.ts
import { SlackClient } from '../clients/slack-client.js';

export class MyService {
  constructor(private slackClient: SlackClient) {}

  async doSomething(input: string): Promise<string> {
    const messages = await this.slackClient.getChannelHistory(input);
    return `Processed ${messages.length} messages`;
  }
}
```

## Common Imports

```typescript
// Date utilities
import { DateUtils } from '../utils/date-utils.js';
const { oldest, latest } = DateUtils.getDateRange(args.date);
const dateStr = DateUtils.formatDateString(new Date());
const windows = DateUtils.getTestSearchWindows('2026-01-15', 7);

// Text analysis
import { TextAnalyzer } from '../utils/analyzers.js';
const tickets = TextAnalyzer.extractTickets(text);
const { isBlocking, isCritical } = TextAnalyzer.analyzeIssueSeverity(text);
const isHotfix = TextAnalyzer.isHotfixContext(text);
const isUIBlock = TextAnalyzer.hasUIBlockContext(text);

// Patterns
import { BLOCKING_PATTERNS, CRITICAL_PATTERNS, RESOLUTION_PATTERNS } from '../utils/patterns.js';
const hasBlocking = BLOCKING_PATTERNS.explicit.some(p => p.test(text));
const isResolved = RESOLUTION_PATTERNS.some(p => p.pattern.test(text));

// Auth
import { SlackAuth } from '../auth/slack-auth.js';
SlackAuth.getInstance().validateWriteAccess(channel);
const client = SlackAuth.getInstance().getClient();

// LLM
import { OllamaClient } from '../clients/ollama-client.js';
const client = new OllamaClient();
if (await client.isAvailable()) {
  const response = await client.generate('prompt', { temperature: 0.3 });
  const clean = OllamaClient.cleanResponse(response);
  const json = OllamaClient.extractBalancedJSON(clean);
}
```

## Slack Formatting (CRITICAL)

```typescript
// CORRECT - Slack format
output += `*Bold Text*`;                    // Single asterisks
output += `<https://url.com|Link Text>`;   // Angle brackets
output += `*Header*`;                       // Bold for headers

// WRONG - Standard markdown (breaks in Slack)
output += `**Bold Text**`;                  // Double asterisks
output += `[Link Text](https://url.com)`;  // Square brackets
output += `# Header`;                       // Hash headers
```

## Channel Resolution

```typescript
// Supports: 'C123456', '#general', '@username', 'U123456'
const conversationId = await this.slackClient.resolveConversation(args.channel);
```

## Error Handling

```typescript
try {
  const result = await this.slackClient.someOperation();
  if (!result.ok) {
    throw new Error(`Slack API error: ${result.error}`);
  }
  return result;
} catch (error) {
  throw new McpError(ErrorCode.InternalError, `Failed: ${error.message}`);
}
```

## Test Patterns

```typescript
// Mock SlackClient
const mockSlackClient = {
  getChannelHistory: jest.fn().mockResolvedValue([/* messages */]),
  sendMessage: jest.fn().mockResolvedValue({ ts: '1234567890.123' })
};

const service = new MyService(mockSlackClient as any);

// Disable LLM in tests
pipeline.setLLMClassification(false);
```

## Troubleshooting

```bash
# Check Ollama
curl http://localhost:11434/api/tags
ollama list

# Find missing .js extensions
grep -r "from '\./.*[^.]'" src/

# Check for CommonJS
grep -r "require(" src/

# Convert Slack timestamp to date
date -r 1768296887 '+%Y-%m-%d %H:%M'
```
