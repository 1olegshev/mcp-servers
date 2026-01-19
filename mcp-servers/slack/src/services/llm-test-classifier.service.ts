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
      const response = await this.callOllama(prompt);
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
    const threadContent = [
      `[Bot] ${collectText(originalMessage)}`,
      ...replies.map((r) => {
        const isBot = !!(r as any).bot_id;
        const userId = (r as any).user || 'unknown';
        const prefix = isBot ? '[Bot]' : `[User:${userId}]`;
        return `${prefix} ${collectText(r)}`;
      })
    ].join('\n\n');

    // Number the tests for easier reference
    const numberedTests = failedTests.map((t, i) => `${i + 1}. ${t}`).join('\n');

    return `You are analyzing a Slack thread about automated test failures to determine release readiness.

CONTEXT: This is for a QA release decision. Tests that are "not_blocking" or "resolved" mean we CAN release.
Tests "still_failing" or "needs_attention" mean we should NOT release until addressed.

Failed tests to classify:
${numberedTests}

Thread conversation:
${threadContent}

STATUS OPTIONS (use exactly these values):
- resolved: Test passed on rerun, or someone confirmed it's fixed ("I fixed it", "passing now", "fix merged", "fixed them so they pass")
- not_blocking: Explicitly stated as not blocking release ("not blocking", "behind a feature flag", "not a release blocker", "behind the role", "not blocking as per")
- fix_in_progress: Someone is actively fixing or said they fixed it for next run ("I'll fix", "working on fix", "I have fixed them", "will check", "need to update the spec")
- flakey: Passes locally but fails in CI - environment-specific, NOT a real bug ("passing locally", "passed after rerun", "works for me locally", "can be stabilised")
- needs_attention: Confirmed failing locally - real bug that needs fixing ("failing locally")
- investigating: Someone is looking into it ("I'll look", "checking", "will investigate", "I'll have a look")
- tracked: Known issue with existing ticket ("there's a ticket", "open ticket", "same as last time", link to Jira/KAHOOT-)
- still_failing: Confirmed still broken after fix attempts ("still failing", "same issue", "not fixed yet")
- unclear: Test NOT mentioned in ANY reply - no one has commented on it yet

CRITICAL RULES:
1. "passing locally" or "passed after rerun" → flakey (environment-specific)
2. "failing locally" → needs_attention (confirmed real bug!)
3. "not blocking" or "behind a role/flag" → not_blocking (safe for release!)
4. "I fixed it" or "I have fixed them for next run" → fix_in_progress
5. If a user is tagged (cc @someone) for a test and that user replies, assume they're discussing that test
6. "same as last time" + ticket reference → tracked
7. If test is NOT mentioned in any human reply → unclear
8. Look at the LATEST status mentioned - if someone said "failing locally" then later "I fixed it", use fix_in_progress

Output ONLY valid JSON (no markdown, no explanation):
{"tests":[{"id":1,"status":"not_blocking","confidence":90,"reason":"User explicitly said not blocking"}]}`;
  }

  /**
   * Call Ollama API using shared client
   */
  private async callOllama(prompt: string): Promise<string> {
    return this.ollamaClient.generate(prompt, {
      temperature: 0.3,
      num_predict: 512,
      timeout: 30000
    });
  }

  /**
   * Map simple status strings to emoji-prefixed versions
   */
  private mapStatus(status: string): string {
    const statusMap: Record<string, string> = {
      'resolved': '✅ resolved',
      'not_blocking': '✅ not blocking',
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

      if (Array.isArray(parsed.tests)) {
        for (const test of parsed.tests) {
          // Support both id (1-indexed number) and name (string) formats
          let testName: string | null = null;
          if (typeof test.id === 'number' && test.id >= 1 && test.id <= failedTests.length) {
            testName = failedTests[test.id - 1]; // Convert 1-indexed to 0-indexed
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
