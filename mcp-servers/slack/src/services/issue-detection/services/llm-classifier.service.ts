/**
 * LLM Classifier Service
 * Uses local Ollama with Qwen3 to classify Slack messages as blockers
 * Replaces complex regex patterns with semantic understanding
 */

import { SlackMessage } from '../../../types/index.js';
import { OllamaClient } from '../../../clients/ollama-client.js';

export interface ClassificationResult {
  isBlocker: boolean;
  confidence: number; // 0-100
  reasoning: string;
  ticketKey?: string;
}

export class LLMClassifierService {
  private ollamaClient: OllamaClient;
  private enabled: boolean;

  constructor(ollamaClient?: OllamaClient) {
    this.ollamaClient = ollamaClient || new OllamaClient();
    this.enabled = true;
  }

  /**
   * Check if Ollama is available
   */
  async isAvailable(): Promise<boolean> {
    return this.ollamaClient.isAvailable();
  }

  /**
   * Classify a message and its thread context to determine if it's a release blocker
   */
  async classifyMessage(
    message: SlackMessage,
    threadContext: SlackMessage[] = []
  ): Promise<ClassificationResult> {
    if (!this.enabled) {
      return this.fallbackClassification(message);
    }

    const prompt = this.buildPrompt(message, threadContext);

    try {
      const response = await this.callOllama(prompt);
      return this.parseResponse(response, message);
    } catch (error) {
      console.error('LLM classification failed, using fallback:', error);
      return this.fallbackClassification(message);
    }
  }

  /**
   * Batch classify multiple messages for efficiency
   */
  async classifyMessages(
    messages: Array<{ message: SlackMessage; threadContext: SlackMessage[] }>
  ): Promise<ClassificationResult[]> {
    // Process in parallel with concurrency limit
    const results: ClassificationResult[] = [];
    const concurrency = 3;

    for (let i = 0; i < messages.length; i += concurrency) {
      const batch = messages.slice(i, i + concurrency);
      const batchResults = await Promise.all(
        batch.map(({ message, threadContext }) =>
          this.classifyMessage(message, threadContext)
        )
      );
      results.push(...batchResults);
    }

    return results;
  }

  /**
   * Build the classification prompt
   */
  private buildPrompt(message: SlackMessage, threadContext: SlackMessage[]): string {
    const mainText = message.text || '';
    const threadText = threadContext
      .map(m => m.text || '')
      .filter(t => t.length > 0)
      .join('\n---\n');

    return `Is this Slack message reporting an ACTIVE release blocker that needs resolution?

ACTIVE BLOCKER (isBlocker=true):
- "release blocker", "blocking the release", "no go"
- "will hotfix", "needs hotfix", "hotfix needed" = blocker identified, fix pending
- Escalation to @test-managers about an issue
- Unresolved critical bug blocking release

NOT A BLOCKER (isBlocker=false):
- "Frontend release update" = STATUS SUMMARY from test manager, not a blocker report
- "we can release", "good to release", "good to go" = blockers are RESOLVED
- "hotfix ready", "hotfix deployed", "hotfix done", "fixed" = issue is RESOLVED
- "blocking us to retest/test" = workflow inconvenience, not release blocker
- Questions like "Is this a blocker?"
- UI terms: "answer blocks", "code block"
- "not blocking", "no longer blocking"

KEY DISTINCTION:
- "will hotfix X" = BLOCKER (action pending)
- "hotfix ready/deployed" = NOT blocker (action completed)

Message: "${mainText}"
${threadText ? `\nThread context:\n${threadText}` : ''}

Output JSON only:
{"isBlocker": true/false, "confidence": 0-100, "reasoning": "brief reason"}`;
  }

  /**
   * Call Ollama API using shared client
   */
  private async callOllama(prompt: string): Promise<string> {
    return this.ollamaClient.generate(prompt, {
      temperature: 0.3,
      num_predict: 256,
      timeout: 30000
    });
  }

  /**
   * Parse the LLM response into a structured result
   * Uses shared helpers for response cleaning and JSON extraction
   */
  private parseResponse(response: string, message: SlackMessage): ClassificationResult {
    try {
      // Use shared helpers for response cleaning and JSON extraction
      const cleanResponse = OllamaClient.cleanResponse(response);
      const jsonStr = OllamaClient.extractBalancedJSON(cleanResponse);

      if (!jsonStr) {
        throw new Error('No JSON found in response');
      }

      const parsed = JSON.parse(jsonStr);

      // Extract ticket key from message
      const ticketMatch = (message.text || '').match(/\b([A-Z]+-\d+)\b/);

      return {
        isBlocker: Boolean(parsed.isBlocker),
        confidence: Math.min(100, Math.max(0, Number(parsed.confidence) || 50)),
        reasoning: String(parsed.reasoning || 'No reasoning provided'),
        ticketKey: ticketMatch ? ticketMatch[1] : undefined
      };
    } catch (error) {
      console.error('Failed to parse LLM response:', response.substring(0, 200));
      return this.fallbackClassification(message);
    }
  }

  /**
   * Fallback classification using simple keyword matching
   * Used when Ollama is unavailable or fails
   */
  private fallbackClassification(message: SlackMessage): ClassificationResult {
    const text = (message.text || '').toLowerCase();
    const ticketMatch = (message.text || '').match(/\b([A-Z]+-\d+)\b/);

    // Simple keyword-based fallback
    const blockingKeywords = ['blocker', 'blocking', 'hotfix', 'no-go', 'no go'];
    const negativeKeywords = ['not a blocker', 'not blocking', 'is this a blocker'];

    const hasBlocking = blockingKeywords.some(k => text.includes(k));
    const hasNegative = negativeKeywords.some(k => text.includes(k));

    return {
      isBlocker: hasBlocking && !hasNegative,
      confidence: 30, // Low confidence for fallback
      reasoning: 'Fallback classification (LLM unavailable)',
      ticketKey: ticketMatch ? ticketMatch[1] : undefined
    };
  }

  /**
   * Disable LLM classification (use fallback only)
   */
  disable(): void {
    this.enabled = false;
  }

  /**
   * Enable LLM classification
   */
  enable(): void {
    this.enabled = true;
  }
}
