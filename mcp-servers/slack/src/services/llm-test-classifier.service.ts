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

    return `Classify each test failure based on the thread discussion.

Failed tests:
${numberedTests}

Thread:
${threadContent}

STATUS DEFINITIONS (important distinctions):
- flakey: "passing locally" or "passes for me" = environment-specific, not a real bug
- needs_attention: "failing locally" = confirmed real issue that needs fixing
- resolved: explicitly fixed or passed on rerun
- investigating: someone said they'll look into it
- still_failing: confirmed still broken, "same as before"
- unclear: test NOT MENTIONED in any reply = awaiting review

IMPORTANT RULES:
1. If someone says a test is "passing locally" → flakey
2. If someone says a test is "failing locally" → needs_attention (NOT flakey!)
3. If a test is NOT mentioned by anyone in the thread → unclear (awaiting review)
4. If @UserX is tagged for a test and UserX replies without mentioning a specific test, assume they're discussing the test they were tagged for

Output ONLY valid JSON:
{"tests":[{"id":1,"status":"flakey","confidence":80}]}`;
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
