/**
 * Issue Detection Pipeline
 * Main orchestrator coordinating all services in the pipeline pattern
 * Raw Messages → Parse → Analyze → LLM Classify → Deduplicate → Issues
 */

import { Issue } from '../../../types/index.js';
import { ISlackMessageService } from '../models/service-interfaces.js';
import { IPatternMatcher } from '../models/service-interfaces.js';
import { IContextAnalyzer } from '../models/service-interfaces.js';
import { IDeduplicator } from '../models/service-interfaces.js';
import { DetectionResult } from '../models/detection-result.model.js';
import { LLMClassifierService, ClassificationResult } from '../services/llm-classifier.service.js';

export class IssueDetectionPipeline {
  private llmClassifier: LLMClassifierService | null = null;
  private useLLMClassification: boolean = true;
  private llmInitialized: boolean = false;

  constructor(
    private messageService: ISlackMessageService,
    private patternMatcher: IPatternMatcher,
    private contextAnalyzer: IContextAnalyzer,
    private deduplicator: IDeduplicator
  ) {
    // LLM classifier is lazily initialized on first use
    // This prevents connection attempts during tests
  }

  /**
   * Lazily initialize the LLM classifier if Ollama is available
   * Called only when LLM classification is actually needed
   */
  private async ensureLLMClassifierInitialized(): Promise<void> {
    if (this.llmInitialized) {
      return;
    }
    this.llmInitialized = true;

    try {
      this.llmClassifier = new LLMClassifierService();
      const available = await this.llmClassifier.isAvailable();
      if (!available) {
        this.useLLMClassification = false;
      }
    } catch {
      this.useLLMClassification = false;
    }
  }

  /**
   * Enable or disable LLM classification
   */
  setLLMClassification(enabled: boolean): void {
    this.useLLMClassification = enabled;
  }

  /**
   * Main pipeline execution method
   * Orchestrates the flow: Messages → Parse → Analyze → Deduplicate → LLM Classify → Result
   *
   * Note: Deduplication happens BEFORE LLM classification to minimize expensive LLM calls.
   * If we have 10 messages about PROJ-123, we deduplicate to 1 first, then call LLM once.
   */
  async detectIssues(channel: string, date: string): Promise<Issue[]> {
    try {
      // Step 1: Fetch raw messages from Slack
      const rawMessages = await this.messageService.findBlockerMessages(channel, date);

      // Step 2: Parse messages for blocker patterns and extract tickets
      const parsedTickets = this.parseMessagesForTickets(rawMessages);

      // Step 3: Analyze tickets in context (threads)
      const analyzedIssues = await this.analyzeTicketsInContext(parsedTickets, rawMessages);

      // Step 4: Deduplicate and prioritize issues FIRST (reduces LLM calls)
      const deduplicatedIssues = this.deduplicator.deduplicateWithPriority(analyzedIssues);

      // Step 5: LLM Classification (filter false positives on deduplicated set)
      const finalIssues = await this.applyLLMClassification(deduplicatedIssues, rawMessages);

      return finalIssues;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Issue detection pipeline failed: ${errorMessage}`);
    }
  }

  /**
   * Apply LLM classification to filter false positives
   * Only runs if Ollama is available and LLM classification is enabled
   */
  private async applyLLMClassification(issues: Issue[], rawMessages: any[]): Promise<Issue[]> {
    // Skip if LLM classification is disabled
    if (!this.useLLMClassification) {
      return issues;
    }

    // Lazily initialize the LLM classifier on first use
    await this.ensureLLMClassifierInitialized();

    // Skip if classifier not available after initialization attempt
    if (!this.llmClassifier) {
      return issues;
    }

    // Check if Ollama is available
    const available = await this.llmClassifier.isAvailable();
    if (!available) {
      return issues;
    }

    const filteredIssues: Issue[] = [];
    const messageMap = new Map<string, any>();

    // Build a map of messages by timestamp for quick lookup
    for (const msg of rawMessages) {
      if (msg.ts) messageMap.set(msg.ts, msg);
    }

    for (const issue of issues) {
      // Find the original message for this issue
      const originalMessage = messageMap.get(issue.timestamp) || { text: issue.text };

      // Get thread context if available
      const threadContext = rawMessages.filter(
        m => m.thread_ts === issue.timestamp || m.ts === issue.timestamp
      );

      try {
        const classification = await this.llmClassifier.classifyMessage(
          originalMessage,
          threadContext
        );

        if (classification.isBlocker) {
          filteredIssues.push({
            ...issue,
            llmConfidence: classification.confidence,
            llmReasoning: classification.reasoning
          } as Issue);
        }
      } catch {
        // On error, keep the issue (fail-safe)
        filteredIssues.push(issue);
      }
    }

    return filteredIssues;
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
