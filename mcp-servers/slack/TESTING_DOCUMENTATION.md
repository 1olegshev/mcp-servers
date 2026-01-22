# Slack MCP Server - Testing

## Overview

| Metric | Value |
|--------|-------|
| Framework | Jest + TypeScript (ESM) |
| Tests | 125 passing |
| Coverage | Pattern matching, deduplication, pipeline, handlers |

**Note:** These tests cover regex/pattern logic only. LLM classification (the critical path) is tested manually.

## Running Tests

```bash
npm test              # Run all tests
npm run test:watch    # Watch mode
npm run test:coverage # With coverage report
```

## Test Structure

```
src/services/issue-detection/__tests__/
├── blocker-pattern.service.test.ts    # Text pattern matching
├── smart-deduplicator.service.test.ts # Deduplication logic
├── pipeline.integration.test.ts       # Pipeline orchestration
└── error-handling.test.ts             # Edge cases

src/handlers/__tests__/
└── analysis.handler.test.ts           # MCP tool validation
```

## What's Tested

| Suite | Tests | What it covers |
|-------|-------|----------------|
| BlockerPatternService | 18 | Blocker/critical keyword detection, JIRA extraction, resolution patterns |
| SmartDeduplicatorService | 5 | Thread vs list priority, deduplication logic |
| IssueDetectionPipeline | 11 | End-to-end flow, error handling, partial failures |
| AnalysisHandler | 13 | MCP tool params, response format, error handling |
| Error Handling | 16 | API failures, malformed data, concurrency |

## Test Patterns

### Basic Service Test
```typescript
describe('ServiceName', () => {
  let service: ServiceName;

  beforeEach(() => {
    service = new ServiceName(dependencies);
  });

  it('should handle primary use case', () => {
    const result = service.method(input);
    expect(result).toBe(expected);
  });
});
```

### Mocking
```typescript
const mockSlackClient = {
  getChannelHistory: jest.fn().mockResolvedValue([/* messages */]),
  sendMessage: jest.fn().mockResolvedValue({ ts: '123' })
};

const service = new MyService(mockSlackClient as any);
```

### Error Testing
```typescript
it('should handle errors gracefully', async () => {
  mockDep.method.mockRejectedValue(new Error('Test error'));
  await expect(service.method()).rejects.toThrow('Expected message');
});
```

## What's NOT Tested

- LLM classification (`llm-classifier.service.ts`, `llm-test-classifier.service.ts`)
- Slack API integration (mocked in tests)
- Real message parsing edge cases

LLM behavior is validated manually during development.
