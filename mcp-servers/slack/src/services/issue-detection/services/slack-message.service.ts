/**
 * Slack Message Service
 * Handles all Slack API communication for issue detection
 * Extracted from the monolithic IssueDetectorService
 */

import { SlackClient } from '../../../clients/slack-client.js';
import { SlackMessage } from '../../../types/index.js';
import { ISlackMessageService } from '../models/service-interfaces.js';
import { TEST_MANAGER_UPDATE_PATTERNS } from '../../../utils/patterns.js';

export class SlackMessageService implements ISlackMessageService {
  constructor(private slackClient: SlackClient) {}

  /**
   * Find messages containing blocker/blocking keywords for a given date
   * Uses Slack's search API to find seed messages
   */
  async findBlockerMessages(channel: string, date: string): Promise<SlackMessage[]> {
    const dateFilter = date === 'today' || !date ? 'on:today' : `on:${date}`;

    const searches = [
      `"release blocker" ${dateFilter}`,
      `blocker ${dateFilter}`,
      `blocking ${dateFilter}`,
      `critical ${dateFilter}`,
      `urgent ${dateFilter}`,
      `hotfix ${dateFilter}`,
      `"no go" ${dateFilter}`,
    ];

    let seedMessages: SlackMessage[] = [];

    const searchPromises = searches.map(query =>
      this.slackClient.searchMessages(query, channel)
    );
    const results = await Promise.allSettled(searchPromises);
    const seenTs = new Set<string>();

    let fulfilledCount = 0;
    for (const result of results) {
      if (result.status === 'fulfilled') {
        fulfilledCount++;
        for (const message of result.value) {
          if (message.ts && !seenTs.has(message.ts)) {
            seenTs.add(message.ts);
            seedMessages.push(message as SlackMessage);
          }
        }
      }
    }

    // If all searches failed, throw an error
    if (fulfilledCount === 0 && results.length > 0) {
      throw new Error('All Slack API searches failed');
    }

    // Filter out messages containing negative phrases
    const negativePhrases = [
      'not blocking',
      'not a blocker',
      'not urgent',
      'not critical',
      'not super high priority',
      'low priority',
      'no need to tackle immediately',
      'not tackle immediately',
      'not immediately',
      'no longer blocking'
    ];

    seedMessages = seedMessages.filter(msg => {
      const text = (msg.text || '').toLowerCase();
      return !negativePhrases.some(phrase => text.includes(phrase));
    });

    // Filter out test manager summary messages - they are handled separately
    // and should not be picked up as blocker sources
    seedMessages = seedMessages.filter(msg => {
      const text = msg.text || '';
      return !TEST_MANAGER_UPDATE_PATTERNS.header.test(text);
    });

    return seedMessages;
  }

  /**
   * Get all messages in a thread including the parent message
   * Handles permalink extraction and thread fetching
   */
  async getThreadContext(message: SlackMessage, channel: string = 'functional-testing'): Promise<SlackMessage[]> {
    const threadId = this.extractThreadId(message);

    if (!threadId) {
      // Return single message if no thread
      return [message];
    }

    try {
      // Fetch the parent message details directly
      const parentMessage = await this.slackClient.getMessageDetails(
        await this.slackClient.resolveConversation(channel),
        threadId
      );

      // Fetch the replies for that thread
      const threadReplies = await this.slackClient.getThreadReplies(
        await this.slackClient.resolveConversation(channel),
        threadId
      );

      // Ensure the parent is part of the full text for ticket extraction
      const fullThreadMessages = [parentMessage];
      if (!threadReplies.some(m => m.ts === parentMessage.ts)) {
        fullThreadMessages.push(...threadReplies);
      } else {
        fullThreadMessages.push(...threadReplies);
      }

      return fullThreadMessages;
    } catch (e) {
      console.error(`Failed to fetch full context for thread ${threadId}:`, e);
      return [message]; // Return original message on error
    }
  }

  /**
   * Extract thread ID from message, handling permalink fallback
   */
  private extractThreadId(message: any): string | undefined {
    if (message.thread_ts) {
      return message.thread_ts;
    }

    // Try to extract from permalink: /archives/CHANNEL/pTIMESTAMP?thread_ts=THREAD_TS
    const permalink = message.permalink;
    if (permalink) {
      const threadTsMatch = permalink.match(/[?&]thread_ts=([^&]+)/);
      if (threadTsMatch) {
        return threadTsMatch[1];
      }
    }

    return undefined;
  }
}
