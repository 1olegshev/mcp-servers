/**
 * Context Analyzer Service
 * Handles thread analysis and context extraction for tickets
 * Extracted from the monolithic IssueDetectorService
 */

import { SlackClient } from '../../../clients/slack-client.js';
import { TextAnalyzer } from '../../../utils/analyzers.js';
import { SlackMessage, Issue, JiraTicketInfo } from '../../../types/index.js';
import { IContextAnalyzer, TicketContext } from '../models/service-interfaces.js';

export class ContextAnalyzerService implements IContextAnalyzer {
  constructor(private slackClient: SlackClient) {}

  /**
   * Analyze a specific ticket's blocking status within a thread context
   */
  async analyzeTicketInContext(ticket: JiraTicketInfo, context: SlackMessage[]): Promise<Issue> {
    const blockingAnalysis = await this.analyzeTicketBlockingStatusInThread(
      context,
      ticket.key,
      '' // channel will be determined from context
    );

    return {
      type: blockingAnalysis.isBlocking ? 'blocking' : 'none',
      text: this.extractTicketContextFromThread(context, ticket.key),
      tickets: [ticket],
      timestamp: context[0]?.ts || '',
      hasThread: context.length > 1,
      permalink: await this.getThreadPermalink(context[0], 'functional-testing')
    } as Issue;
  }

  /**
   * Analyze all tickets mentioned in threads and return issues
   */
  async analyzeTickets(tickets: TicketContext[], messages: SlackMessage[]): Promise<Issue[]> {
    const issues: Issue[] = [];

    // Group messages by thread
    const threadGroups = this.groupMessagesByThread(messages);

    for (const [threadId, threadMessages] of threadGroups) {
      const threadIssues = await this.analyzeThreadForTicketSpecificBlocking(
        threadMessages,
        threadId
      );
      issues.push(...threadIssues);
    }

    return issues;
  }

  /**
   * Group messages by their thread
   */
  private groupMessagesByThread(messages: SlackMessage[]): Map<string, SlackMessage[]> {
    const threadGroups = new Map<string, SlackMessage[]>();

    for (const message of messages) {
      const threadId = message.thread_ts || message.ts!;
      if (!threadGroups.has(threadId)) {
        threadGroups.set(threadId, []);
      }
      threadGroups.get(threadId)!.push(message);
    }

    return threadGroups;
  }

  /**
   * Analyze thread for ticket-specific blocking status
   */
  private async analyzeThreadForTicketSpecificBlocking(
    threadMessages: SlackMessage[],
    parentTimestamp: string
  ): Promise<Issue[]> {
    const issues: Issue[] = [];
    const permalink = await this.getThreadPermalink(threadMessages[0], parentTimestamp ? 'functional-testing' : 'functional-testing');

    // Collect all tickets mentioned in the thread
    const allThreadTickets = new Map<string, JiraTicketInfo>();
    for (const message of threadMessages) {
      const tickets = this.extractTicketsFromMessage(message);
      for (const ticket of tickets) {
        if (!allThreadTickets.has(ticket.key)) {
          allThreadTickets.set(ticket.key, ticket);
        }
      }
    }

    // Analyze each ticket individually for blocking status
    for (const [ticketKey, ticketInfo] of allThreadTickets) {
      const blockingAnalysis = await this.analyzeTicketBlockingStatusInThread(
        threadMessages,
        ticketKey,
        '' // channel context
      );

      if (blockingAnalysis.isBlocking) {
        issues.push({
          type: 'blocking',
          text: this.extractTicketContextFromThread(threadMessages, ticketKey),
          tickets: [ticketInfo],
          timestamp: parentTimestamp,
          hasThread: threadMessages.length > 1,
          permalink,
          hotfixCommitment: blockingAnalysis.hasHotfixCommitment
        } as Issue);
      }
    }

    return issues;
  }

  /**
   * Analyze if a specific ticket is mentioned as blocking within a thread
   */
  private async analyzeTicketBlockingStatusInThread(
    threadMessages: SlackMessage[],
    ticketKey: string,
    channel: string
  ): Promise<{ isBlocking: boolean; isResolved: boolean; hasHotfixCommitment: boolean }> {
    let isBlocking = false;
    let isResolved = false;
    let hasHotfixCommitment = false;

    // BUSINESS RULE: Hotfixes are ONLY made for blockers
    // Check for hotfix context first - if ticket is in hotfix list, it's automatically blocking
    let foundInHotfixContext = false;

    // First check if ticket is explicitly mentioned in a hotfix context
    for (const message of threadMessages) {
      const text = (message.text || '').toLowerCase();
      const mentionsTicket = text.includes(ticketKey.toLowerCase());

      if (mentionsTicket && TextAnalyzer.isHotfixContext(text)) {
        isBlocking = true;
        foundInHotfixContext = true;
        hasHotfixCommitment = true;
        break; // Found in hotfix context, no need to check further
      }
    }

    // CRITICAL: Check for "will hotfix this" style messages that don't mention the ticket explicitly
    // If a reply says "will hotfix this one" or "@test-managers will hotfix", it refers to the thread's ticket
    if (!foundInHotfixContext && threadMessages.length > 0) {
      // Check if ticket is mentioned in parent (first message)
      const parentText = (threadMessages[0]?.text || '').toLowerCase();
      const ticketInParent = parentText.includes(ticketKey.toLowerCase());

      if (ticketInParent) {
        // Now check if any reply has a hotfix signal without specifying a different ticket
        for (let i = 1; i < threadMessages.length; i++) {
          const replyText = (threadMessages[i]?.text || '').toLowerCase();
          // Look for "will hotfix" patterns
          const hasHotfixSignal = /will\s+hotfix/i.test(replyText) ||
                                  /hotfix\s+this/i.test(replyText) ||
                                  /this\s+(?:one\s+)?(?:is\s+a\s+)?(?:blocker|needs?\s+hotfix)/i.test(replyText);
          // Make sure it's not about a different ticket
          const mentionsDifferentTicket = /KAHOOT-\d+/i.test(replyText) &&
                                          !replyText.includes(ticketKey.toLowerCase());

          if (hasHotfixSignal && !mentionsDifferentTicket) {
            isBlocking = true;
            foundInHotfixContext = true;
            hasHotfixCommitment = true;
            break;
          }
        }
      }
    }

    // First pass: check for explicit ticket-specific blocking/resolution mentions
    for (const message of threadMessages) {
      const text = (message.text || '').toLowerCase();

      // Check if this message mentions the specific ticket
      const mentionsTicket = text.includes(ticketKey.toLowerCase());
      const mentionsBlockers = /\bblockers?\b/i.test(text) || /\bblocking\b/i.test(text);

      // If message mentions blockers but not this specific ticket, it might be referring to others
      if (mentionsBlockers && !mentionsTicket) {
        // Look for patterns like "blockers are just 65023, 65025" or "65023 and 65025 are blockers"
        const ticketNumbers = text.match(/\b\d{5}\b/g) || [];
        if (ticketNumbers.some(num => ticketKey.includes(num))) {
          isBlocking = true;
        }
      }

      // If message mentions this ticket specifically
      if (mentionsTicket) {
        // EARLY EXIT: Skip blocking detection if this is UI context
        if (TextAnalyzer.hasUIBlockContext(message.text || '')) {
          continue; // Skip this message, it's UI terminology
        }

        // EARLY EXIT: Ignore ad blocker mentions unless tied to release context
        if (TextAnalyzer.isAdBlockerNonReleaseContext(message.text || '')) {
          continue;
        }

        // Check for blocking indicators
        // Note: "blocks" alone is too broad (matches UI "answer blocks", etc.)
        // Only match "blocks" when combined with release/deploy/prod context
        const explicitBlockerPatterns = [
          /\bblocker\b/i,
          /\bblocking\b/i,
          /release\s*blocker/i,
          /no.?go/i,
          /@test.managers/i,
          /hotfix/i
        ];

        // "blocks" requires release context (consistent with blocker-pattern.service)
        const releaseContext = /(\bblock(s)?\b|\bblocking\b).*\b(release|deploy(?:ment)?|prod(?:uction)?)\b/i.test(text);

        const hasBlockingKeyword = explicitBlockerPatterns.some(pattern => pattern.test(text)) || releaseContext;
        const hasHotfixCommitmentMatch = /(\(\s*fix\s+ready\s*\)|\bwe\s+will\s+hotfix\b)/i.test(text);

        // Check for resolution keywords
        const resolutionPatterns = [
          /\bresolved\b/i,
          /\bfixed\b/i,
          /\bdeployed\b/i,
          /not.*blocking/i,
          /no.*longer.*blocking/i,
          /\bnot a blocker\b/i
        ];

        const hasResolutionKeyword = resolutionPatterns.some(pattern => pattern.test(text));

        if (hasBlockingKeyword || hasHotfixCommitmentMatch) {
          isBlocking = true;
          if (hasHotfixCommitmentMatch) {
            hasHotfixCommitment = true;
          }
        }

        if (hasResolutionKeyword && !hasHotfixCommitmentMatch && !hasHotfixCommitment) {
          isResolved = true;
          // BUSINESS RULE: Don't override hotfix context - hotfixes are always blockers even if marked "ready"
          if (!foundInHotfixContext) {
            isBlocking = false;
          }
        }
      }
    }

    // Second pass: if no explicit mentions found, check for general blocking statements
    if (!isBlocking && !isResolved) {
      isBlocking = this.checkForGeneralBlockingStatements(threadMessages, ticketKey);
    }

    return { isBlocking, isResolved, hasHotfixCommitment };
  }

  /**
   * Check for general blocking statements that might refer to tickets in the thread
   */
  private checkForGeneralBlockingStatements(threadMessages: SlackMessage[], ticketKey: string): boolean {
    for (const message of threadMessages) {
      const text = (message.text || '').toLowerCase();

      // Look for statements like "these are blockers" or "blockers are just X, Y"
      if (/\bblockers?\b/i.test(text) && /\bjust\b/i.test(text)) {
        // Extract ticket numbers from the message
        const ticketNumbers = text.match(/\b\d{5}\b/g) || [];
        const ticketKeys = ticketNumbers.map(num => `KAHOOT-${num}`);

        if (ticketKeys.includes(ticketKey)) {
          return true;
        }
      }

      // Look for generic blocking statements in threads with tickets
      if (/\bblocker\b/i.test(text) && /\bticket\b/i.test(text)) {
        // Be more conservative - only mark as blocking if:
        // 1. The blocking statement is clearly about the existing ticket, OR
        // 2. It's a follow-up to the specific issue described in parent
        const hasClearBlockingIntent = /prio.*blocker/i.test(text) ||
                                      /priority.*blocker/i.test(text) ||
                                      /label.*blocker/i.test(text);

        // Additional check: if it's about creating a new ticket with different context,
        // don't associate it with existing tickets
        const isCreatingNewTicket = /let's make a ticket/i.test(text) ||
                                   /create.*ticket/i.test(text) ||
                                   /new ticket/i.test(text);

        const hasDifferentContext = /engaging.learning/i.test(text) ||
                                   /component.*player/i.test(text) ||
                                   /label.*[^b]/i.test(text); // different label than blocker

        if (hasClearBlockingIntent && !isCreatingNewTicket && !hasDifferentContext) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Extract relevant context for a specific ticket from thread messages
   */
  private extractTicketContextFromThread(threadMessages: SlackMessage[], ticketKey: string): string {
    // Find the most relevant message mentioning this ticket
    for (const message of threadMessages) {
      const text = message.text || '';
      if (text.includes(ticketKey)) {
        return text.substring(0, 200) + (text.length > 200 ? '...' : '');
      }
    }

    // Fallback to parent message
    return (threadMessages[0]?.text || '').substring(0, 200) + ((threadMessages[0]?.text || '').length > 200 ? '...' : '');
  }

  /**
   * Extract tickets from a single message
   */
  private extractTicketsFromMessage(message: SlackMessage): JiraTicketInfo[] {
    const jiraBaseUrl = process.env.JIRA_BASE_URL || 'https://mobitroll.atlassian.net';
    return TextAnalyzer.extractTickets(message.text || '', jiraBaseUrl);
  }

  /**
   * Get permalink for a thread
   */
  private async getThreadPermalink(message: SlackMessage, channel: string = 'functional-testing'): Promise<string | undefined> {
    if (!message.ts) return undefined;

    try {
      const conversationId = await this.slackClient.resolveConversation(channel);
      return await this.slackClient.getPermalink(conversationId, message.ts);
    } catch (error) {
      console.error('Failed to get thread permalink:', error);
      return undefined;
    }
  }

}
