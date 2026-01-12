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

    const threadContent = [
      `[Bot] ${collectText(originalMessage)}`,
      ...replies.map((r, i) => {
        const isBot = !!(r as any).bot_id;
        const prefix = isBot ? '[Bot]' : '[Human]';
        return `${prefix} ${collectText(r)}`;
      })
    ].join('\n\n');

    const testList = failedTests.map(t => `- ${t}`).join('\n');

    return `Analyze this test failure thread and classify each failed test's status.

FAILED TESTS:
${testList}

THREAD CONTENT:
${threadContent}

For each failed test, determine its status from these categories:
- "✅ resolved" - Test passed on rerun, fix deployed, or explicitly marked as fixed
- "✅ not blocking" - Reviewed and determined not to block release
- "🔄 assigned" - Someone took ownership ("on me", "I'll handle")
- "🔄 rerun in progress" - Rerun triggered/started but no result yet
- "🔄 fix in progress" - Fix being worked on or in review
- "🔍 investigating" - Being looked into but no conclusion yet
- "⚠️ flakey/env-specific" - Passes locally, intermittent, or environment issue
- "🛠️ test update required" - Selector changed, button moved, test needs update
- "ℹ️ acknowledged" - Known issue, team aware
- "ℹ️ explained" - Root cause identified and explained
- "❌ still failing" - Confirmed still failing after rerun/fix attempt
- "❓ needs review" - No clear status from thread, needs human attention

Think about each test's status based on the thread discussion, then output JSON:
{
  "tests": [
    {"name": "test_name", "status": "✅ resolved", "confidence": 85, "reasoning": "Passed on rerun per message 3"},
    ...
  ],
  "summary": "2 resolved, 1 investigating"
}`;
  }

  /**
   * Call Ollama API
   */
  private async callOllama(prompt: string): Promise<string> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000); // 60 second timeout

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
            num_predict: 1024
          }
        }),
        signal: controller.signal
      });

      clearTimeout(timeout);

      if (!response.ok) {
        throw new Error(`Ollama API error: ${response.status}`);
      }

      const data = await response.json();
      return data.response || '';
    } catch (error) {
      clearTimeout(timeout);
      throw error;
    }
  }

  /**
   * Parse LLM response and extract test statuses
   */
  private parseResponse(response: string, failedTests: string[]): ThreadClassificationResult {
    // Remove thinking tokens if present
    let cleanResponse = response;
    const thinkMatch = response.match(/<think>([\s\S]*?)<\/think>/);
    if (thinkMatch) {
      cleanResponse = response.replace(/<think>[\s\S]*?<\/think>/, '').trim();
    }

    // Try to extract JSON from response
    const jsonMatch = cleanResponse.match(/\{[\s\S]*"tests"[\s\S]*\}/);
    if (!jsonMatch) {
      console.error('No JSON found in LLM response');
      return this.fallbackClassification(failedTests);
    }

    try {
      const parsed = JSON.parse(jsonMatch[0]);
      const perTestStatus: Record<string, TestStatusClassification> = {};

      if (Array.isArray(parsed.tests)) {
        for (const test of parsed.tests) {
          const testName = this.matchTestName(test.name, failedTests);
          if (testName) {
            perTestStatus[testName] = {
              testName,
              status: test.status || '❓ needs review',
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
