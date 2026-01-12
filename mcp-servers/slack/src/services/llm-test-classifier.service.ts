/**
 * LLM-based Test Thread Classifier Service
 *
 * Uses local Ollama with Qwen3 14B to semantically classify test failure statuses
 * from Slack thread replies. Provides more accurate classification than regex-only
 * approach, especially for ambiguous or complex replies.
 */

import { SlackMessage } from '../types/index.js';
import { extractAllMessageText } from '../utils/message-extractor.js';

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
  private ollamaUrl: string;
  private model: string;
  private enabled: boolean;
  private availabilityChecked: boolean = false;
  private isOllamaAvailable: boolean = false;

  constructor(
    ollamaUrl: string = 'http://localhost:11434',
    model: string = 'qwen3:14b'
  ) {
    this.ollamaUrl = ollamaUrl;
    this.model = model;
    this.enabled = true;
  }

  /**
   * Check if Ollama is available and the model is loaded
   */
  async isAvailable(): Promise<boolean> {
    if (this.availabilityChecked) {
      return this.isOllamaAvailable;
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(`${this.ollamaUrl}/api/tags`, {
        signal: controller.signal
      });
      clearTimeout(timeout);

      if (!response.ok) {
        this.isOllamaAvailable = false;
        this.availabilityChecked = true;
        return false;
      }

      const data = await response.json();
      const models = data.models || [];
      this.isOllamaAvailable = models.some((m: any) =>
        m.name === this.model || m.name.startsWith(this.model.split(':')[0])
      );
      this.availabilityChecked = true;
      return this.isOllamaAvailable;
    } catch (error) {
      this.isOllamaAvailable = false;
      this.availabilityChecked = true;
      return false;
    }
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

    // Include full thread content - there are only 3 test threads total
    // so we need full context to understand which reply refers to which test
    const threadContent = [
      `[Bot] ${collectText(originalMessage)}`,
      ...replies.map((r) => {
        const isBot = !!(r as any).bot_id;
        const prefix = isBot ? '[Bot]' : '[Human]';
        return `${prefix} ${collectText(r)}`;
      })
    ].join('\n\n');

    // Simpler, more focused prompt for faster response
    return `What is the status of these test failures based on the thread discussion?

Tests: ${failedTests.join(', ')}

Thread:
${threadContent}

For each test, pick ONE status:
- resolved (passed on rerun, fixed)
- not_blocking (reviewed, ok to release)
- investigating (looking into it)
- flakey (passes locally, intermittent)
- still_failing (confirmed still broken)
- unclear (no info)

Output ONLY this JSON format:
{"tests":[{"name":"test","status":"resolved","confidence":80}]}`;
  }

  /**
   * Call Ollama API
   */
  private async callOllama(prompt: string): Promise<string> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000); // 30 second timeout

    try {
      const response = await fetch(`${this.ollamaUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          prompt: prompt,
          stream: false,
          options: {
            temperature: 0.3,
            num_predict: 512
          },
          think: false  // Disable thinking for fast responses
        }),
        signal: controller.signal
      });

      clearTimeout(timeout);

      if (!response.ok) {
        throw new Error(`Ollama API error: ${response.status}`);
      }

      const data = await response.json();
      // Qwen3 puts thinking in separate field, actual output in response
      // Prefer response (contains JSON), fall back to thinking if response empty
      if (data.response && data.response.trim()) {
        return data.response;
      }
      // If response is empty, check thinking field (token limit reached mid-think)
      return data.thinking || '';
    } catch (error) {
      clearTimeout(timeout);
      throw error;
    }
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
      'still_failing': '❌ still failing',
      'unclear': '❓ needs review',
    };
    return statusMap[status.toLowerCase()] || status;
  }

  /**
   * Extract balanced JSON from text - handles nested braces correctly
   */
  private extractBalancedJSON(text: string): string | null {
    const start = text.indexOf('{');
    if (start === -1) return null;

    let depth = 0;
    let inString = false;
    let escape = false;

    for (let i = start; i < text.length; i++) {
      const char = text[i];

      if (escape) {
        escape = false;
        continue;
      }

      if (char === '\\' && inString) {
        escape = true;
        continue;
      }

      if (char === '"') {
        inString = !inString;
        continue;
      }

      if (inString) continue;

      if (char === '{') depth++;
      else if (char === '}') {
        depth--;
        if (depth === 0) {
          return text.substring(start, i + 1);
        }
      }
    }

    return null;
  }

  /**
   * Parse LLM response and extract test statuses
   */
  private parseResponse(response: string, failedTests: string[]): ThreadClassificationResult {
    // Remove thinking tokens if present (Qwen3 adds <think>...</think> blocks)
    let cleanResponse = response;
    cleanResponse = cleanResponse.replace(/<think>[\s\S]*?<\/think>/gi, '');

    // Handle unclosed <think> tags - take everything after it
    const thinkStart = cleanResponse.indexOf('<think>');
    if (thinkStart !== -1) {
      cleanResponse = cleanResponse.substring(thinkStart + 7); // Skip past <think>
    }

    // Trim whitespace and remove markdown code block markers
    cleanResponse = cleanResponse.trim();
    cleanResponse = cleanResponse.replace(/^```json?\s*/i, '').replace(/\s*```$/i, '');

    // Use balanced bracket extraction for proper JSON parsing
    const jsonStr = this.extractBalancedJSON(cleanResponse);

    if (!jsonStr) {
      console.error('No JSON found in LLM response. Raw response:', response.substring(0, 300));
      return this.fallbackClassification(failedTests);
    }

    try {
      const parsed = JSON.parse(jsonStr);
      const perTestStatus: Record<string, TestStatusClassification> = {};

      if (Array.isArray(parsed.tests)) {
        for (const test of parsed.tests) {
          const testName = this.matchTestName(test.name, failedTests);
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
