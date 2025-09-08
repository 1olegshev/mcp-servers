/**
 * Service interfaces for the Issue Detection refactoring
 * Defines contracts for all services in the pipeline
 */

import { SlackMessage, Issue, JiraTicketInfo } from '../../../types/index.js';

export interface ISlackMessageService {
  /**
   * Find messages containing blocker/blocking keywords for a given date
   */
  findBlockerMessages(channel: string, date: string): Promise<SlackMessage[]>;

  /**
   * Get all messages in a thread including the parent message
   */
  getThreadContext(message: SlackMessage, channel?: string): Promise<SlackMessage[]>;
}

export interface IPatternMatcher {
  /**
   * Check if text contains blocking indicators
   */
  hasBlockingIndicators(text: string): boolean;

  /**
   * Check if text contains critical indicators
   */
  hasCriticalIndicators(text: string): boolean;

  /**
   * Extract JIRA ticket information from text
   */
  extractTickets(text: string): JiraTicketInfo[];

  /**
   * Parse explicit blocker lists from messages
   * e.g., "Blockers: • TICKET-123 • TICKET-456"
   */
  parseBlockerList(text: string): TicketContext[];
}

export interface IContextAnalyzer {
  /**
   * Analyze a specific ticket's blocking status within a thread context
   */
  analyzeTicketInContext(ticket: JiraTicketInfo, context: SlackMessage[]): Promise<Issue>;

  /**
   * Analyze all tickets mentioned in a thread and return issues
   */
  analyzeTickets(tickets: TicketContext[], messages: SlackMessage[]): Promise<Issue[]>;
}

export interface IDeduplicator {
  /**
   * Deduplicate issues with priority rules:
   * - Prefer issues with thread context over list-only issues
   * - Maintain thread links and permalinks
   */
  deduplicateWithPriority(issues: Issue[]): Issue[];
}

/**
 * Data structures for internal use within the issue detection pipeline
 */
export interface TicketContext {
  key: string;
  url?: string;
  project?: string;
  threadLink?: string;
  sourceText?: string;
}

export interface DetectionResult {
  issues: Issue[];
  analyzedThreads: number;
  totalMessages: number;
  processingTime: number;
}

export interface DetectionConfig {
  channel: string;
  date: string;
  severity: 'blocking' | 'critical' | 'both';
  includeResolved: boolean;
}
