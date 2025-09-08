/**
 * Issue Detection Pipeline
 * Main orchestrator coordinating all services in the pipeline pattern
 * Raw Messages → Parse → Analyze → Deduplicate → Issues
 */

import { Issue } from '../../../types/index.js';
import { ISlackMessageService } from '../models/service-interfaces.js';
import { IPatternMatcher } from '../models/service-interfaces.js';
import { IContextAnalyzer } from '../models/service-interfaces.js';
import { IDeduplicator } from '../models/service-interfaces.js';
import { DetectionResult } from '../models/detection-result.model.js';

export class IssueDetectionPipeline {
  constructor(
    private messageService: ISlackMessageService,
    private patternMatcher: IPatternMatcher,
    private contextAnalyzer: IContextAnalyzer,
    private deduplicator: IDeduplicator
  ) {}

  /**
   * Main pipeline execution method
   * Orchestrates the flow: Messages → Parse → Analyze → Deduplicate → Result
   */
  async detectIssues(channel: string, date: string): Promise<Issue[]> {
    const startTime = Date.now();

    try {
      // Step 1: Fetch raw messages from Slack
      const rawMessages = await this.messageService.findBlockerMessages(channel, date);

      // Step 2: Parse messages for blocker patterns and extract tickets
      const parsedTickets = this.parseMessagesForTickets(rawMessages);

      // Step 3: Analyze tickets in context (threads)
      const analyzedIssues = await this.analyzeTicketsInContext(parsedTickets, rawMessages);

      // Step 4: Deduplicate and prioritize issues
      const finalIssues = this.deduplicator.deduplicateWithPriority(analyzedIssues);

      const processingTime = Date.now() - startTime;

      return finalIssues;

    } catch (error) {
      console.error('Error in issue detection pipeline:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Issue detection pipeline failed: ${errorMessage}`);
    }
  }

  /**
   * Parse messages for blocker patterns and extract tickets
   */
  private parseMessagesForTickets(messages: any[]): any[] {
    const allTickets: any[] = [];

    for (const message of messages) {
      const text = message.text || '';

      // Check for explicit blocker lists (e.g., "Blockers: • TICKET-123")
      const blockerTickets = this.patternMatcher.parseBlockerList(text);
      allTickets.push(...blockerTickets);

      // Also extract any other tickets mentioned in the message
      const mentionedTickets = this.patternMatcher.extractTickets(text);
      for (const ticket of mentionedTickets) {
        // Only add if not already in blocker list
        if (!allTickets.some(t => t.key === ticket.key)) {
          allTickets.push({
            key: ticket.key,
            url: ticket.url,
            project: ticket.project,
            sourceText: text,
            timestamp: message.ts
          });
        }
      }
    }

    return allTickets;
  }

  /**
   * Analyze tickets in their thread context
   */
  private async analyzeTicketsInContext(tickets: any[], messages: any[]): Promise<Issue[]> {
    const allIssues: Issue[] = [];

    // Group messages by thread for efficient processing
    const threadGroups = this.groupMessagesByThread(messages);

    for (const [threadId, threadMessages] of threadGroups) {
      // Get tickets relevant to this thread
      const relevantTickets = this.filterTicketsForThread(tickets, threadMessages);

      if (relevantTickets.length > 0) {
        // Analyze this thread for the relevant tickets
        const threadIssues = await this.contextAnalyzer.analyzeTickets(relevantTickets, threadMessages);
        allIssues.push(...threadIssues);
      }
    }

    // Also handle tickets that weren't found in any thread
    const unthreadedTickets = tickets.filter(ticket =>
      !this.isTicketInAnyThread(ticket, Array.from(threadGroups.values()))
    );

    for (const ticket of unthreadedTickets) {
      // Create a basic issue for tickets not in threads
      const basicIssue: Issue = {
        type: this.patternMatcher.hasBlockingIndicators(ticket.sourceText || '') ? 'blocking' : 'critical',
        text: ticket.sourceText || `Ticket ${ticket.key} mentioned`,
        tickets: [{
          key: ticket.key,
          url: ticket.url,
          project: ticket.project
        }],
        timestamp: ticket.timestamp || '',
        hasThread: false
      };
      allIssues.push(basicIssue);
    }

    return allIssues;
  }

  /**
   * Group messages by their thread ID
   */
  private groupMessagesByThread(messages: any[]): Map<string, any[]> {
    const threadGroups = new Map<string, any[]>();

    for (const message of messages) {
      const threadId = message.thread_ts || message.ts;
      if (!threadGroups.has(threadId)) {
        threadGroups.set(threadId, []);
      }
      threadGroups.get(threadId)!.push(message);
    }

    return threadGroups;
  }

  /**
   * Filter tickets that are relevant to a specific thread
   */
  private filterTicketsForThread(tickets: any[], threadMessages: any[]): any[] {
    const threadText = threadMessages.map(m => m.text || '').join(' ');
    const relevantTickets: any[] = [];

    for (const ticket of tickets) {
      // Check if ticket is mentioned in this thread
      if (threadText.includes(ticket.key)) {
        relevantTickets.push(ticket);
      }
    }

    return relevantTickets;
  }

  /**
   * Check if a ticket appears in any of the thread groups
   */
  private isTicketInAnyThread(ticket: any, threadGroups: any[][]): boolean {
    for (const threadMessages of threadGroups) {
      const threadText = threadMessages.map(m => m.text || '').join(' ');
      if (threadText.includes(ticket.key)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Enhanced pipeline with detailed result reporting
   */
  async detectIssuesWithDetails(channel: string, date: string): Promise<DetectionResult> {
    const startTime = Date.now();

    const issues = await this.detectIssues(channel, date);
    const processingTime = Date.now() - startTime;

    // This is a simplified calculation - in a real implementation,
    // you'd track these metrics throughout the pipeline
    const analyzedThreads = Math.max(1, Math.floor(issues.filter(i => i.hasThread).length));
    const totalMessages = issues.reduce((sum, issue) => sum + (issue.hasThread ? 2 : 1), 0);

    return {
      issues,
      analyzedThreads,
      totalMessages,
      processingTime
    };
  }

  /**
   * Validate pipeline configuration and dependencies
   */
  validatePipeline(): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!this.messageService) {
      errors.push('SlackMessageService is not configured');
    }

    if (!this.patternMatcher) {
      errors.push('PatternMatcher is not configured');
    }

    if (!this.contextAnalyzer) {
      errors.push('ContextAnalyzer is not configured');
    }

    if (!this.deduplicator) {
      errors.push('Deduplicator is not configured');
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }
}
