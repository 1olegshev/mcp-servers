/**
 * Test Manager Update Detector
 * Detects and parses the daily release status update from the test manager.
 *
 * The message typically looks like:
 * "Frontend release update [responsible_dev] @Reuben @Mathias ... cc @test-managers
 *  Manual testing and RC: [done][close to be done]
 *  Autotests: [reviewed]
 *  [List of hotfixes]
 *  We can [start hotfixing][release] [responsible_dev]"
 *
 * This message represents the human test manager's decision and should:
 * - Be reflected in the release status summary
 * - NOT be used as a source for blocker detection (it's a summary, not a source)
 *
 * The detector uses LLM to analyze the main message AND thread replies
 * to capture the current state, which may have evolved from the original post.
 */

import { SlackClient } from '../clients/slack-client.js';
import { OllamaClient } from '../clients/ollama-client.js';
import { SlackMessage } from '../types/index.js';
import { DateUtils } from '../utils/date-utils.js';
import { TEST_MANAGER_UPDATE_PATTERNS } from '../utils/patterns.js';

export interface TestManagerUpdate {
  found: boolean;
  decision?: 'release' | 'start_hotfixing' | 'unknown';
  decisionEvolved?: boolean;  // True if thread shows decision changed from original
  manualTestingStatus?: 'done' | 'close_to_done' | 'in_progress' | 'unknown';
  autotestsStatus?: 'reviewed' | 'pending' | 'unknown';
  responsibleDev?: string;
  hotfixes?: string[];
  summary?: string;  // LLM-generated summary of current state
  rawMessage?: string;
  timestamp?: string;
  permalink?: string;
  threadRepliesCount?: number;
}

// Re-export for backward compatibility
export { TEST_MANAGER_UPDATE_PATTERNS };

export class TestManagerUpdateDetector {
  private ollamaClient: OllamaClient;
  private jiraBaseUrl: string;

  constructor(private slackClient: SlackClient) {
    this.ollamaClient = new OllamaClient();
    this.jiraBaseUrl = process.env.JIRA_BASE_URL || 'https://mobitroll.atlassian.net';
  }

  /**
   * Search for the test manager update message for a given date
   */
  async findTestManagerUpdate(channel: string, date?: string): Promise<TestManagerUpdate> {
    try {
      const { oldest, latest } = DateUtils.getDateRange(date);

      // Fetch messages for the date range
      const conversationId = await this.slackClient.resolveConversation(channel);
      const messages = await this.slackClient.getChannelHistoryForDateRange(
        conversationId,
        oldest,
        latest,
        200
      );

      // Search for the test manager update message
      for (const message of messages) {
        if (this.isTestManagerUpdateMessage(message)) {
          return this.analyzeTestManagerUpdate(message, channel);
        }
      }

      // Also try search API for more reliable results
      const dateFilter = date === 'today' || !date ? 'on:today' : `on:${date}`;
      const searchResults = await this.slackClient.searchMessages(
        `"Frontend release update" ${dateFilter}`,
        channel
      );

      for (const message of searchResults) {
        if (this.isTestManagerUpdateMessage(message as SlackMessage)) {
          return this.analyzeTestManagerUpdate(message as SlackMessage, channel);
        }
      }

      return { found: false };
    } catch (error) {
      console.error('Error finding test manager update:', error);
      return { found: false };
    }
  }

  /**
   * Check if a message is a test manager update
   */
  isTestManagerUpdateMessage(message: SlackMessage): boolean {
    const text = message.text || '';

    // Must have the "Frontend release update" header
    if (!TEST_MANAGER_UPDATE_PATTERNS.header.test(text)) {
      return false;
    }

    // Should have at least one indicator of a release status update
    const hasDecision =
      TEST_MANAGER_UPDATE_PATTERNS.canRelease.test(text) ||
      TEST_MANAGER_UPDATE_PATTERNS.goodToRelease.test(text) ||
      TEST_MANAGER_UPDATE_PATTERNS.canStartHotfixing.test(text) ||
      TEST_MANAGER_UPDATE_PATTERNS.willHotfix.test(text);

    const hasStatus =
      TEST_MANAGER_UPDATE_PATTERNS.manualTestingDone.test(text) ||
      TEST_MANAGER_UPDATE_PATTERNS.manualTestingAlmostDone.test(text) ||
      TEST_MANAGER_UPDATE_PATTERNS.autotestsReviewed.test(text);

    const hasTestManagersMention = TEST_MANAGER_UPDATE_PATTERNS.testManagersMention.test(text);

    return hasDecision || hasStatus || hasTestManagersMention;
  }

  /**
   * Analyze the test manager update message with thread context using LLM
   */
  private async analyzeTestManagerUpdate(message: SlackMessage, channel: string): Promise<TestManagerUpdate> {
    const text = message.text || '';

    // Fetch thread replies if the message has a thread
    let threadReplies: SlackMessage[] = [];
    if (message.ts && (message.reply_count || message.thread_ts)) {
      try {
        const threadTs = message.thread_ts || message.ts;
        threadReplies = await this.slackClient.getThreadReplies(channel, threadTs);
      } catch (error) {
        console.error('Error fetching thread replies:', error);
      }
    }

    // Get permalink
    let permalink: string | undefined;
    try {
      if (message.ts) {
        permalink = await this.slackClient.getPermalink(channel, message.ts);
      }
    } catch {
      // Ignore permalink errors
    }

    // Try LLM analysis first
    const llmAvailable = await this.ollamaClient.isAvailable();
    if (llmAvailable) {
      try {
        const llmResult = await this.analyzewithLLM(text, threadReplies);
        return {
          found: true,
          ...llmResult,
          rawMessage: text,
          timestamp: message.ts,
          permalink,
          threadRepliesCount: threadReplies.length,
        };
      } catch (error) {
        console.error('LLM analysis failed, using pattern fallback:', error);
      }
    }

    // Fallback to pattern-based analysis
    return this.patternBasedAnalysis(message, threadReplies, channel, permalink);
  }

  /**
   * Use LLM to analyze the test manager update and thread
   */
  private async analyzewithLLM(mainMessage: string, threadReplies: SlackMessage[]): Promise<Partial<TestManagerUpdate>> {
    const threadText = threadReplies
      .map((m, i) => `Reply ${i + 1}: ${m.text || ''}`)
      .filter(t => t.length > 10)
      .join('\n');

    const prompt = `Analyze this test manager release status update and any thread replies.

MAIN MESSAGE:
${mainMessage}

${threadText ? `THREAD REPLIES (${threadReplies.length} total):\n${threadText}` : 'NO THREAD REPLIES YET'}

Extract the CURRENT state (thread updates override the main message):

1. DECISION: What is the current release decision?
   - "release" = ready to release / good to go / we can release
   - "start_hotfixing" = need to hotfix first / will hotfix / hotfixing before release
   - "unknown" = no clear decision yet

2. DECISION_EVOLVED: Did the decision change in the thread? (true/false)
   Example: Main said "hotfix" but thread later says "good to release" = true

3. MANUAL_TESTING: Current status
   - "done" = completed / done
   - "close_to_done" = almost done / almost completed
   - "in_progress" = still testing
   - "unknown" = not mentioned

4. AUTOTESTS: Current status
   - "reviewed" = reviewed / passed / good to go
   - "pending" = waiting / need to review
   - "unknown" = not mentioned

5. HOTFIXES: List any JIRA ticket keys mentioned (e.g., KAHOOT-12345)

6. SUMMARY: One sentence describing the current state (max 100 chars)

Output JSON only:
{"decision": "release|start_hotfixing|unknown", "decisionEvolved": true/false, "manualTestingStatus": "done|close_to_done|in_progress|unknown", "autotestsStatus": "reviewed|pending|unknown", "hotfixes": ["TICKET-123"], "summary": "brief summary"}`;

    const response = await this.ollamaClient.generate(prompt, {
      temperature: 0.2,
      num_predict: 512,
      timeout: 45000
    });

    return this.parseLLMResponse(response);
  }

  /**
   * Parse the LLM response into structured data
   */
  private parseLLMResponse(response: string): Partial<TestManagerUpdate> {
    try {
      const cleanResponse = OllamaClient.cleanResponse(response);
      const jsonStr = OllamaClient.extractBalancedJSON(cleanResponse);

      if (!jsonStr) {
        throw new Error('No JSON found in response');
      }

      const parsed = JSON.parse(jsonStr);

      return {
        decision: this.normalizeDecision(parsed.decision),
        decisionEvolved: Boolean(parsed.decisionEvolved),
        manualTestingStatus: this.normalizeManualTestingStatus(parsed.manualTestingStatus),
        autotestsStatus: this.normalizeAutotestsStatus(parsed.autotestsStatus),
        hotfixes: Array.isArray(parsed.hotfixes) ? parsed.hotfixes.filter((t: any) => typeof t === 'string') : undefined,
        summary: typeof parsed.summary === 'string' ? parsed.summary.slice(0, 150) : undefined,
      };
    } catch (error) {
      console.error('Failed to parse LLM response:', response.substring(0, 200));
      throw error;
    }
  }

  private normalizeDecision(value: any): TestManagerUpdate['decision'] {
    if (value === 'release') return 'release';
    if (value === 'start_hotfixing' || value === 'hotfix' || value === 'hotfixing') return 'start_hotfixing';
    return 'unknown';
  }

  private normalizeManualTestingStatus(value: any): TestManagerUpdate['manualTestingStatus'] {
    if (value === 'done') return 'done';
    if (value === 'close_to_done' || value === 'almost_done') return 'close_to_done';
    if (value === 'in_progress') return 'in_progress';
    return 'unknown';
  }

  private normalizeAutotestsStatus(value: any): TestManagerUpdate['autotestsStatus'] {
    if (value === 'reviewed' || value === 'passed') return 'reviewed';
    if (value === 'pending' || value === 'waiting') return 'pending';
    return 'unknown';
  }

  /**
   * Fallback pattern-based analysis when LLM is unavailable
   */
  private async patternBasedAnalysis(
    message: SlackMessage,
    threadReplies: SlackMessage[],
    _channel: string,
    permalink?: string
  ): Promise<TestManagerUpdate> {
    const text = message.text || '';
    const allText = [text, ...threadReplies.map(r => r.text || '')].join('\n');

    // Check for decision in thread first (newest takes precedence)
    let decision: TestManagerUpdate['decision'] = 'unknown';
    let decisionEvolved = false;

    // Check thread replies in reverse order (newest first)
    for (const reply of [...threadReplies].reverse()) {
      const replyText = reply.text || '';
      if (TEST_MANAGER_UPDATE_PATTERNS.canRelease.test(replyText) ||
          TEST_MANAGER_UPDATE_PATTERNS.goodToRelease.test(replyText)) {
        decision = 'release';
        decisionEvolved = true;
        break;
      }
      if (TEST_MANAGER_UPDATE_PATTERNS.canStartHotfixing.test(replyText) ||
          TEST_MANAGER_UPDATE_PATTERNS.willHotfix.test(replyText)) {
        decision = 'start_hotfixing';
        decisionEvolved = true;
        break;
      }
    }

    // If no decision in thread, check main message
    if (decision === 'unknown') {
      if (TEST_MANAGER_UPDATE_PATTERNS.canRelease.test(text) ||
          TEST_MANAGER_UPDATE_PATTERNS.goodToRelease.test(text)) {
        decision = 'release';
      } else if (TEST_MANAGER_UPDATE_PATTERNS.canStartHotfixing.test(text) ||
                 TEST_MANAGER_UPDATE_PATTERNS.willHotfix.test(text)) {
        decision = 'start_hotfixing';
      }
    }

    // Extract manual testing status
    let manualTestingStatus: TestManagerUpdate['manualTestingStatus'] = 'unknown';
    if (TEST_MANAGER_UPDATE_PATTERNS.manualTestingDone.test(allText)) {
      manualTestingStatus = 'done';
    } else if (TEST_MANAGER_UPDATE_PATTERNS.manualTestingAlmostDone.test(allText)) {
      manualTestingStatus = 'close_to_done';
    }

    // Extract autotests status
    let autotestsStatus: TestManagerUpdate['autotestsStatus'] = 'unknown';
    if (TEST_MANAGER_UPDATE_PATTERNS.autotestsReviewed.test(allText)) {
      autotestsStatus = 'reviewed';
    }

    // Extract hotfix tickets from all text
    const hotfixes = this.extractHotfixTickets(allText);

    return {
      found: true,
      decision,
      decisionEvolved,
      manualTestingStatus,
      autotestsStatus,
      hotfixes: hotfixes.length > 0 ? hotfixes : undefined,
      rawMessage: text,
      timestamp: message.ts,
      permalink,
      threadRepliesCount: threadReplies.length,
    };
  }

  /**
   * Extract hotfix ticket keys from the message
   */
  private extractHotfixTickets(text: string): string[] {
    const tickets: string[] = [];
    const ticketPattern = /\b([A-Z]+-\d+)\b/g;
    let match;

    while ((match = ticketPattern.exec(text)) !== null) {
      if (!tickets.includes(match[1])) {
        tickets.push(match[1]);
      }
    }

    return tickets;
  }

  /**
   * Format the test manager update for display in the report
   */
  formatTestManagerUpdate(update: TestManagerUpdate): string {
    if (!update.found) {
      return '';
    }

    let output = `\n👤 *Test Manager Decision*\n`;

    // Decision line with emoji
    if (update.decision === 'release') {
      output += `✅ *We can release*`;
    } else if (update.decision === 'start_hotfixing') {
      output += `🔧 *Hotfixing first*`;
    } else {
      output += `⏳ *Decision pending*`;
    }

    // Note if decision evolved
    if (update.decisionEvolved) {
      output += ` _(updated in thread)_`;
    }
    output += '\n';

    // LLM summary if available
    if (update.summary) {
      output += `> ${update.summary}\n`;
    }

    // Status summary
    const statuses: string[] = [];
    if (update.manualTestingStatus === 'done') {
      statuses.push('Manual testing: done');
    } else if (update.manualTestingStatus === 'close_to_done') {
      statuses.push('Manual testing: almost done');
    } else if (update.manualTestingStatus === 'in_progress') {
      statuses.push('Manual testing: in progress');
    }

    if (update.autotestsStatus === 'reviewed') {
      statuses.push('Autotests: reviewed');
    } else if (update.autotestsStatus === 'pending') {
      statuses.push('Autotests: pending');
    }

    if (statuses.length > 0) {
      output += `${statuses.join(' • ')}\n`;
    }

    // Hotfixes if any
    if (update.hotfixes && update.hotfixes.length > 0) {
      output += `Hotfixes: ${update.hotfixes.join(', ')}\n`;
    }

    // Thread indicator
    if (update.threadRepliesCount && update.threadRepliesCount > 0) {
      output += `_${update.threadRepliesCount} thread replies analyzed_\n`;
    }

    // Link to original message
    if (update.permalink) {
      output += `<${update.permalink}|View message>\n`;
    }

    return output;
  }
}
