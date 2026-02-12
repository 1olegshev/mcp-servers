/**
 * LLM Classifier Service
 * Uses local LLM (via OpenAI-compatible API) to classify Slack messages as blockers
 * Replaces complex regex patterns with semantic understanding
 */

import { SlackMessage } from '../../../types/index.js';
import { LocalLLMClient } from '../../../clients/local-llm-client.js';

export interface ClassificationResult {
  isBlocker: boolean;
  confidence: number; // 0-100
  reasoning: string;
  ticketKey?: string;
}

/** JSON schema for structured LLM output */
const BLOCKER_CLASSIFICATION_SCHEMA = {
  type: 'object',
  properties: {
    isBlocker: { type: 'boolean' },
    confidence: { type: 'number' },
    reasoning: { type: 'string' }
  },
  required: ['isBlocker', 'confidence', 'reasoning']
};

export class LLMClassifierService {
  private llmClient: LocalLLMClient;
  private enabled: boolean;

  constructor(llmClient?: LocalLLMClient) {
    this.llmClient = llmClient || new LocalLLMClient();
    this.enabled = true;
  }

  /**
   * Check if Ollama is available
   */
  async isAvailable(): Promise<boolean> {
    return this.llmClient.isAvailable();
  }

  /**
   * Classify a message and its thread context to determine if it's a release blocker
   */
  async classifyMessage(
    message: SlackMessage,
    threadContext: SlackMessage[] = []
  ): Promise<ClassificationResult> {
    if (!this.enabled) {
      return this.fallbackClassification(message, threadContext);
    }

    const prompt = this.buildPrompt(message, threadContext);

    try {
      const response = await this.callLLM(prompt);
      return this.parseResponse(response, message);
    } catch (error) {
      console.error('LLM classification failed, using fallback:', error);
      return this.fallbackClassification(message, threadContext);
    }
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

STILL A BLOCKER (isBlocker=true):
- "hotfix ready", "hotfix PR" = fix is prepared but NOT yet deployed, blocker persists
- "we can start hotfixing" = hotfix process initiated, blocker persists

NOT A BLOCKER (isBlocker=false):
- "Frontend release update" = STATUS SUMMARY from test manager, not a blocker report
- "we can release", "good to release", "good to go" = blockers are RESOLVED
- "hotfix deployed", "hotfix done", "hotfix merged", "fixed" = issue is RESOLVED
- "blocking us to retest/test" = workflow inconvenience, not release blocker
- Questions like "Is this a blocker?"
- UI terms: "answer blocks", "code block"
- "not blocking", "no longer blocking"

KEY DISTINCTION:
- "will hotfix X" / "hotfix ready" / "hotfix PR" = BLOCKER (fix pending deployment)
- "hotfix deployed" / "hotfix done" / "hotfix merged" = NOT blocker (fix deployed)

Message: "${mainText}"
${threadText ? `\nThread context:\n${threadText}` : ''}

Output JSON only:
{"isBlocker": true/false, "confidence": 0-100, "reasoning": "brief reason"}`;
  }

  /**
   * Call LLM API using shared client with structured JSON output
   */
  private async callLLM(prompt: string): Promise<string> {
    return this.llmClient.generate(prompt, {
      temperature: 0.3,
      maxTokens: 256,
      timeout: 30000,
      responseSchema: BLOCKER_CLASSIFICATION_SCHEMA
    });
  }

  /**
   * Parse the LLM response into a structured result
   * With structured output format, response is guaranteed to be valid JSON
   */
  private parseResponse(response: string, message: SlackMessage): ClassificationResult {
    try {
      // With structured output, response should be valid JSON directly
      // Still clean response for any thinking tokens that might appear
      const cleanResponse = LocalLLMClient.cleanResponse(response);
      const parsed = JSON.parse(cleanResponse);

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
  private fallbackClassification(message: SlackMessage, threadContext: SlackMessage[] = []): ClassificationResult {
    // Check both the main message AND thread context for blocking keywords
    const allTexts = [message.text || '', ...threadContext.map(m => m.text || '')];
    const combinedText = allTexts.join(' ').toLowerCase();
    const ticketMatch = allTexts.join(' ').match(/\b([A-Z]+-\d+)\b/);

    // Simple keyword-based fallback
    const blockingKeywords = ['blocker', 'blocking', 'hotfix', 'no-go', 'no go'];
    const negativeKeywords = ['not a blocker', 'not blocking', 'is this a blocker'];

    const hasBlocking = blockingKeywords.some(k => combinedText.includes(k));
    const hasNegative = negativeKeywords.some(k => combinedText.includes(k));

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
