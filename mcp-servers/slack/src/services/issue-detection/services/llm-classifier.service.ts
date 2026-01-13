/**
 * LLM Classifier Service
 * Uses local Ollama with Qwen3 to classify Slack messages as blockers
 * Replaces complex regex patterns with semantic understanding
 */

import { SlackMessage } from '../../../types/index.js';

export interface ClassificationResult {
  isBlocker: boolean;
  confidence: number; // 0-100
  reasoning: string;
  ticketKey?: string;
}

export interface OllamaResponse {
  model: string;
  created_at: string;
  response: string;
  thinking?: string; // Qwen3 may put thinking in separate field
  done: boolean;
}

export class LLMClassifierService {
  private ollamaUrl: string;
  private model: string;
  private enabled: boolean;

  constructor(
    ollamaUrl: string = 'http://localhost:11434',
    model: string = 'qwen3:30b-a3b-instruct-2507-q4_K_M'  // Non-thinking instruct model
  ) {
    this.ollamaUrl = ollamaUrl;
    this.model = model;
    this.enabled = true;
  }

  /**
   * Check if Ollama is available
   */
  async isAvailable(): Promise<boolean> {
    try {
      const response = await fetch(`${this.ollamaUrl}/api/tags`, {
        method: 'GET',
        signal: AbortSignal.timeout(2000)
      });
      return response.ok;
    } catch {
      return false;
    }
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

    return `Is this Slack message about a RELEASE blocker?

STRONG BLOCKER SIGNALS:
- CC @test-managers = escalation to release gatekeepers, very likely a blocker
- "release blocker", "blocking the release", "hotfix needed", "no go"

NOT A RELEASE BLOCKER:
- "blocking us to retest/test" = workflow inconvenience, not release blocker
- Questions like "Is this a blocker?"
- UI terms: "answer blocks", "code block"
- "not blocking", "no longer blocking"
- "minor issue", "nice to fix", "Legacy bugs" = not release critical

KEY: "blocking" alone often means workflow blocking. "release blocker" or @test-managers = actual release blocker.

Message: "${mainText}"
${threadText ? `\nThread context:\n${threadText}` : ''}

Output JSON only:
{"isBlocker": true/false, "confidence": 0-100, "reasoning": "brief reason"}`;
  }

  /**
   * Call Ollama API
   */
  private async callOllama(prompt: string): Promise<string> {
    const response = await fetch(`${this.ollamaUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        prompt,
        stream: false,
        options: {
          temperature: 0.3, // Low temperature for consistent classification
          num_predict: 256
        },
        think: false  // Disable Qwen3 thinking for faster response
      }),
      signal: AbortSignal.timeout(30000) // 30 second timeout
    });

    if (!response.ok) {
      throw new Error(`Ollama API error: ${response.status}`);
    }

    const data = await response.json() as OllamaResponse;
    // Qwen3 puts thinking in separate field, actual output in response
    // Prefer response (contains JSON), fall back to thinking if response empty
    if (data.response && data.response.trim()) {
      return data.response;
    }
    return data.thinking || '';
  }

  /**
   * Parse the LLM response into a structured result
   * Handles thinking tokens (<think>...</think>) and extracts JSON
   */
  private parseResponse(response: string, message: SlackMessage): ClassificationResult {
    try {
      // Remove thinking tokens if present
      let cleanResponse = response;

      // Remove <think>...</think> blocks
      cleanResponse = cleanResponse.replace(/<think>[\s\S]*?<\/think>/gi, '');

      // Also handle unclosed <think> tags (model might not close them)
      const thinkStart = cleanResponse.indexOf('<think>');
      if (thinkStart !== -1) {
        // Look for JSON after the thinking
        const afterThink = cleanResponse.substring(thinkStart);
        const jsonInThink = afterThink.match(/\{[^{}]*"isBlocker"[^{}]*\}/);
        if (jsonInThink) {
          cleanResponse = jsonInThink[0];
        }
      }

      // Extract JSON from response (handle potential markdown code blocks)
      const jsonMatch = cleanResponse.match(/\{[^{}]*"isBlocker"[^{}]*\}/);
      if (!jsonMatch) {
        // Try to find any JSON object
        const anyJson = cleanResponse.match(/\{[\s\S]*?\}/);
        if (anyJson) {
          cleanResponse = anyJson[0];
        } else {
          throw new Error('No JSON found in response');
        }
      } else {
        cleanResponse = jsonMatch[0];
      }

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
