/**
 * LLM-based Test Thread Classifier Service
 *
 * Uses local Ollama with Qwen3 to semantically classify test failure statuses
 * from Slack thread replies. Provides more accurate classification than regex-only
 * approach, especially for ambiguous or complex replies.
 */

import { SlackMessage } from '../types/index.js';
import { extractAllMessageText } from '../utils/message-extractor.js';
import { OllamaClient } from '../clients/ollama-client.js';

export interface TestStatusClassification {
  testName: string;
  status: string;
  confidence: number;
  reasoning: string;
}

export interface ThreadClassificationResult {
  perTestStatus: Record<string, TestStatusClassification>;
  overallSummary: string;
  usedLLM: boolean;
}

export class LLMTestClassifierService {
  private ollamaClient: OllamaClient;
  private enabled: boolean;

  constructor(ollamaClient?: OllamaClient) {
    this.ollamaClient = ollamaClient || new OllamaClient();
    this.enabled = true;
  }

  /**
   * Check if Ollama is available and the model is loaded
   */
  async isAvailable(): Promise<boolean> {
    return this.ollamaClient.isAvailable();
  }

  /**
   * Classify test failure statuses from a thread
   */
  async classifyThread(
    originalMessage: SlackMessage,
    replies: SlackMessage[],
    failedTests: string[]
  ): Promise<ThreadClassificationResult> {
    if (!this.enabled || failedTests.length === 0) {
      return {
        perTestStatus: {},
        overallSummary: '',
        usedLLM: false
      };
    }

    const available = await this.isAvailable();
    if (!available) {
      return {
        perTestStatus: {},
        overallSummary: 'LLM unavailable',
        usedLLM: false
      };
    }

    try {
      const prompt = this.buildPrompt(originalMessage, replies, failedTests);
      const debugLLM = process.env.DEBUG_LLM === 'true';

      if (debugLLM) {
        console.error('\n=== LLM CLASSIFIER DEBUG ===');
        console.error('Failed tests:', failedTests);
        console.error('Thread content being sent to LLM:');
        console.error(prompt.split('Thread conversation')[1]?.split('STATUS OPTIONS')[0] || 'N/A');
      }

      const response = await this.callOllama(prompt);

      if (debugLLM) {
        console.error('\nLLM RAW RESPONSE:');
        console.error(response);
        console.error('=== END LLM DEBUG ===\n');
      }

      return this.parseResponse(response, failedTests);
    } catch (error) {
      console.error('LLM test classification failed:', error);
      return {
        perTestStatus: {},
        overallSummary: 'LLM classification failed',
        usedLLM: false
      };
    }
  }

  /**
   * Build the classification prompt
   */
  private buildPrompt(
    originalMessage: SlackMessage,
    replies: SlackMessage[],
    failedTests: string[]
  ): string {
    const collectText = (m: SlackMessage): string => {
      const parts: string[] = [];
      if (m.text) parts.push(m.text);
      const extracted = extractAllMessageText(m);
      if (extracted.extractedFromBlocks) parts.push(extracted.extractedFromBlocks);
      if (extracted.extractedFromAttachments) parts.push(extracted.extractedFromAttachments);
      return parts.filter(Boolean).join(' ');
    };

    // Include full thread content with user IDs preserved for tag matching
    // Mark resolution signals explicitly so LLM recognizes them
    const resolutionPattern = /\b(it\s+did\s+pass|now\s+it\s+pass|passes\s+now|works\s+now|it\s+pass(?:es)?|did\s+pass|pass(?:ed|es|ing)?\s+locally|passing\s+now|fixed|resolved|flaky|flakey)\b/i;
    const threadContent = [
      `[Bot] ${collectText(originalMessage)}`,
      ...replies.map((r) => {
        const isBot = !!(r as any).bot_id;
        const userId = (r as any).user || 'unknown';
        const prefix = isBot ? '[Bot]' : `[User:${userId}]`;
        const text = collectText(r);
        const hasResolution = resolutionPattern.test(text);
        const marker = hasResolution ? ' [RESOLUTION SIGNAL]' : '';
        return `${prefix}${marker} ${text}`;
      })
    ].join('\n\n');

    // Number the tests for easier reference
    const numberedTests = failedTests.map((t, i) => `${i + 1}. ${t}`).join('\n');

    return `You are analyzing a Slack thread about automated test failures to determine release readiness.

CONTEXT: This is for a QA release decision. Tests that are "not_blocking" or "resolved" mean we CAN release.
Tests "still_failing" or "needs_attention" mean we should NOT release until addressed.

Failed tests to classify:
${numberedTests}

Thread conversation (messages marked [RESOLUTION SIGNAL] contain phrases indicating the issue was resolved):
${threadContent}

STATUS OPTIONS (use exactly these values):
- resolved: Test passed on rerun, someone confirmed it's fixed, or root cause identified and test passes when run correctly ("I fixed it", "passing now", "fix merged", "it did pass", "now it passes", "works when run with")
- not_blocking: Explicitly stated as not blocking release, or it's a test problem not a product bug ("not blocking", "isn't blocking", "behind a feature flag", "not a release blocker", "no issue", "not an issue", "test problem", "test bug", "forgot to update", "test data change", "not a regression", "data change")
- blocker: Explicitly stated as blocking release ("release blocker", "this is blocking", "blocker for release", "blocks the release")
- fix_in_progress: Someone is actively fixing, or it's being handled ("I'll fix", "I'll try to fix", "working on fix", "work in progress", "work in progress by [name]", "WIP", "[name] is working on it", "handled by [name]", "I have fixed them", "will check", "need to update", "seems like a test issue")
- flakey: Passes locally but fails in CI - environment-specific, NOT a real bug ("passed locally", "passes locally", "passing locally", "passed locally for me", "passes locally for me", "passed after rerun", "works for me locally", "can be stabilised", "flaky")
- needs_attention: Confirmed failing locally - real bug that needs fixing ("failing locally")
- investigating: Someone is looking into it ("I'll look", "checking", "will investigate", "I'll have a look")
- tracked: Known issue with existing ticket ("there's a ticket", "open ticket", "same as last time", link to Jira/KAHOOT-)
- still_failing: Confirmed still broken after fix attempts ("still failing", "same issue", "not fixed yet")
- unclear: Test NOT mentioned in ANY reply - no one has commented on it yet

CRITICAL RULES:
1. "passed locally" or "passes locally" or "passing locally" or "passed after rerun" → flakey (environment-specific)
2. "failing locally" → needs_attention (confirmed real bug!) - BUT check rules 8 and 10 first!
3. "not blocking" or "behind a role/flag" → not_blocking (safe for release!)
4. "I fixed it" or "I have fixed them for next run" → fix_in_progress
5. If a user is tagged (cc @someone) for a test and that user replies, assume they're discussing that test
6. "same as last time" + ticket reference → tracked
7. If test is NOT mentioned in any human reply → unclear
8. MOST IMPORTANT - Find the LAST message that discusses pass/fail status. Ignore follow-up discussions about future work, refactoring, or suggestions - those are NOT relevant to release decision. The last STATUS UPDATE (pass/fail/fixed/still broken) determines the classification. Messages with [RESOLUTION SIGNAL] indicate a status update saying "it works now".
9. If the SAME user who reported "failing locally" later says "it did pass" or "now it works" → resolved (they confirmed their own issue is fixed)
10. If message says "still failing" BUT also mentions "work in progress", "work in progress by [name]", "WIP", or "[name] is working on it" → fix_in_progress (acknowledging failure + someone is assigned = not blocking for release)
11. CRITICAL: If one person says "fails locally" but a DIFFERENT person later says "passes locally" or "passing locally for me" → flakey (environment-specific - works for some people but not others)
12. CONTEXT: If there's only ONE failed test being discussed, any reply about pass/fail status applies to that test even if the test name isn't repeated. Example: Thread about "test-x.ts fails" → reply "passed locally, flaky" → test-x.ts is flakey.
13. OVERRIDE RULE: If User A says "test-x fails locally" and User B LATER says "test-x passing locally" or "test-x passes locally for me" → the test is FLAKEY, not needs_attention. The LATER message supersedes the earlier one. This is environment-specific behavior.

IMPORTANT: You MUST return a classification for EVERY test listed above. If there are 3 tests, return 3 objects in the array.

Output ONLY valid JSON (no markdown, no explanation):
{"tests":[{"id":1,"status":"flakey","confidence":90,"reason":"passes locally"},{"id":2,"status":"fix_in_progress","confidence":85,"reason":"user said will fix"}]}`;
  }

  /**
   * Call Ollama API using shared client
   */
  private async callOllama(prompt: string): Promise<string> {
    return this.ollamaClient.generate(prompt, {
      temperature: 0.3,
      num_predict: 2048,  // Increased for large test lists (14+ tests)
      timeout: 60000
    });
  }

  /**
   * Map simple status strings to emoji-prefixed versions
   */
  private mapStatus(status: string): string {
    const statusMap: Record<string, string> = {
      'resolved': '✅ resolved',
      'not_blocking': '✅ not blocking',
      'blocker': '🚫 blocker',
      'fix_in_progress': '🔄 fix in progress',
      'tracked': '📋 tracked (known issue)',
      'investigating': '🔍 investigating',
      'flakey': '⚠️ flakey/env-specific',
      'flaky': '⚠️ flakey/env-specific',
      'needs_attention': '🚨 needs attention',
      'still_failing': '❌ still failing',
      'unclear': '❓ needs review',
    };
    return statusMap[status.toLowerCase()] || status;
  }

  /**
   * Parse LLM response and extract test statuses
   */
  private parseResponse(response: string, failedTests: string[]): ThreadClassificationResult {
    // Use shared helpers for response cleaning and JSON extraction
    const cleanResponse = OllamaClient.cleanResponse(response);
    const jsonStr = OllamaClient.extractBalancedJSON(cleanResponse);

    if (!jsonStr) {
      console.error('No JSON found in LLM response. Raw response:', response.substring(0, 300));
      return this.fallbackClassification(failedTests);
    }

    try {
      const parsed = JSON.parse(jsonStr);
      const perTestStatus: Record<string, TestStatusClassification> = {};

      // Handle both formats: {"tests": [...]} or just [...]
      const testsArray = Array.isArray(parsed) ? parsed : (Array.isArray(parsed.tests) ? parsed.tests : null);

      if (testsArray) {
        for (const test of testsArray) {
          // Support multiple formats LLMs may use:
          // 1. id as 1-indexed number
          // 2. id as string (test name) - common LLM behavior
          // 3. name as string
          let testName: string | null = null;
          if (typeof test.id === 'number' && test.id >= 1 && test.id <= failedTests.length) {
            testName = failedTests[test.id - 1]; // Convert 1-indexed to 0-indexed
          } else if (typeof test.id === 'string') {
            // LLM used test name as id (common behavior)
            testName = this.matchTestName(test.id, failedTests);
          } else if (test.name) {
            testName = this.matchTestName(test.name, failedTests);
          }

          if (testName) {
            perTestStatus[testName] = {
              testName,
              status: this.mapStatus(test.status || 'unclear'),
              confidence: typeof test.confidence === 'number' ? test.confidence : 50,
              reasoning: test.reasoning || ''
            };
          }
        }
      }

      // Fill in any missing tests
      for (const test of failedTests) {
        if (!perTestStatus[test]) {
          perTestStatus[test] = {
            testName: test,
            status: '❓ needs review',
            confidence: 0,
            reasoning: 'Not found in LLM response'
          };
        }
      }

      return {
        perTestStatus,
        overallSummary: parsed.summary || this.generateSummary(perTestStatus),
        usedLLM: true
      };
    } catch (error) {
      console.error('Failed to parse LLM JSON response:', error);
      return this.fallbackClassification(failedTests);
    }
  }

  /**
   * Match a test name from LLM response to actual test names
   */
  private matchTestName(llmName: string, failedTests: string[]): string | null {
    if (!llmName) return null;

    // Exact match
    if (failedTests.includes(llmName)) return llmName;

    // Normalized match
    const normalize = (s: string) => s
      .toLowerCase()
      .replace(/\.(test|spec)\.[jt]sx?$/i, '')
      .replace(/\.[jt]sx?$/i, '')
      .replace(/^.*[\/]/, '')
      .trim();

    const normalizedLLM = normalize(llmName);
    for (const test of failedTests) {
      if (normalize(test) === normalizedLLM) return test;
    }

    // Partial match
    for (const test of failedTests) {
      if (normalize(test).includes(normalizedLLM) || normalizedLLM.includes(normalize(test))) {
        return test;
      }
    }

    return null;
  }

  /**
   * Generate summary from per-test statuses
   */
  private generateSummary(perTestStatus: Record<string, TestStatusClassification>): string {
    const counts: Record<string, number> = {};
    for (const { status } of Object.values(perTestStatus)) {
      const key = status.replace(/^[✅🔄🔍⚠️🛠️ℹ️❌❓]\s*/, '');
      counts[key] = (counts[key] || 0) + 1;
    }

    return Object.entries(counts)
      .map(([status, count]) => `${count} ${status}`)
      .join(', ');
  }

  /**
   * Fallback when LLM fails
   */
  private fallbackClassification(failedTests: string[]): ThreadClassificationResult {
    const perTestStatus: Record<string, TestStatusClassification> = {};
    for (const test of failedTests) {
      perTestStatus[test] = {
        testName: test,
        status: '❓ needs review',
        confidence: 0,
        reasoning: 'LLM classification unavailable'
      };
    }

    return {
      perTestStatus,
      overallSummary: `${failedTests.length} tests need review`,
      usedLLM: false
    };
  }

  /**
   * Enable/disable LLM classification
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }
}
