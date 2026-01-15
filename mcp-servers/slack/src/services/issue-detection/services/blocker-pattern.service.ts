/**
 * Blocker Pattern Service
 * Handles text pattern matching and ticket extraction
 * Extracted from the monolithic IssueDetectorService
 */

import { TextAnalyzer } from '../../../utils/analyzers.js';
import { JiraTicketInfo } from '../../../types/index.js';
import { IPatternMatcher, TicketContext } from '../models/service-interfaces.js';
import {
  BLOCKING_PATTERNS,
  CRITICAL_PATTERNS,
  RESOLUTION_PATTERNS,
  BLOCKING_KEYWORD_PATTERNS,
} from '../../../utils/patterns.js';

export class BlockerPatternService implements IPatternMatcher {
  private jiraBaseUrl: string;

  constructor(jiraBaseUrl: string = '') {
    this.jiraBaseUrl = jiraBaseUrl;
  }

  /**
   * Check if text contains blocking indicators
   */
  hasBlockingIndicators(text: string): boolean {
    const lowerText = text.toLowerCase();

    // EARLY EXIT: Check for UI context patterns that should NOT be treated as blockers
    if (TextAnalyzer.hasUIBlockContext(text)) {
      return false;
    }

    // EARLY EXIT: Ignore "ad blocker" mentions unless tied to release/deploy context
    if (TextAnalyzer.isAdBlockerNonReleaseContext(text)) {
      return false;
    }

    // BUSINESS RULE: Hotfixes are ONLY made for blockers
    // Check for hotfix context first
    if (TextAnalyzer.isHotfixContext(text)) {
      return true;
    }

    // Check explicit blocking patterns
    const hasExplicit = BLOCKING_PATTERNS.explicit.some(pattern => pattern.test(text));

    // Check contextual patterns (no-go, @test-managers, hotfix)
    const hasContextual = BLOCKING_PATTERNS.contextual.some(pattern => pattern.test(lowerText));

    // Check release context pattern
    const hasReleaseContext = BLOCKING_PATTERNS.releaseContext.test(lowerText);

    return hasExplicit || hasContextual || hasReleaseContext;
  }

  /**
   * Check if text contains critical indicators
   */
  hasCriticalIndicators(text: string): boolean {
    const lower = (text || '').toLowerCase();

    // Check for positive signals using centralized patterns
    const hasPositive = CRITICAL_PATTERNS.positive.some(pattern => pattern.test(lower));
    if (!hasPositive) return false;

    // Check for negative/mitigating signals
    const hasNegative = CRITICAL_PATTERNS.negative.some(pattern => pattern.test(lower));
    if (hasNegative) return false;

    // Check windowed negation
    if (CRITICAL_PATTERNS.windowNegation.test(lower)) return false;

    return true;
  }

  /**
   * Extract JIRA ticket information from text
   */
  extractTickets(text: string): JiraTicketInfo[] {
    return TextAnalyzer.extractTickets(text, this.jiraBaseUrl);
  }

  /**
   * Parse explicit blocker lists from messages
   * e.g., "Blockers: • TICKET-123 • TICKET-456" or "List of hotfixes: • TICKET-123 • TICKET-456"
   * BUSINESS RULE: Hotfixes are ONLY made for blockers
   */
  parseBlockerList(text: string): TicketContext[] {
    const tickets: TicketContext[] = [];

    // Look for explicit blocker lists OR hotfix lists (hotfixes = blockers)
    const isBlockerList = /\bblockers?\b.*:/i.test(text) || /blockers?\s*for/i.test(text);
    const isHotfixList = /list\s+of\s+hotfixes/i.test(text) || /hotfixes?\s*:/i.test(text);

    if (isBlockerList || isHotfixList) {
      // Extract ticket-thread link pairs from the message
      const ticketThreadPairs = this.extractTicketThreadPairs(text);

      for (const { ticketKey, threadLink } of ticketThreadPairs) {
        const ticketInfo: TicketContext = {
          key: ticketKey,
          url: this.jiraBaseUrl ? `${this.jiraBaseUrl}/browse/${ticketKey}` : undefined,
          project: ticketKey.split('-')[0],
          threadLink,
          sourceText: text
        };

        tickets.push(ticketInfo);
      }
    }

    return tickets;
  }

  /**
   * Extract ticket-thread link pairs from blocker list messages
   */
  private extractTicketThreadPairs(text: string): Array<{ticketKey: string, threadLink?: string}> {
    const pairs: Array<{ticketKey: string, threadLink?: string}> = [];

    // Split by bullet points or hyphens to get individual blocker entries
    let lines: string[] = [];

    if (text.includes('•')) {
      lines = text.split('•').slice(1); // Skip first part before first bullet
    } else if (text.includes('\n-')) {
      lines = text.split('\n').filter(line => line.trim().startsWith('-')).map(line => line.trim().substring(1));
    } else if (text.includes('\n•')) {
      lines = text.split('\n').filter(line => line.trim().startsWith('•')).map(line => line.trim().substring(1));
    }

    for (const line of lines) {
      const ticketMatch = line.match(/\b([A-Z]+-\d+)\b/);
      if (ticketMatch) {
        const ticketKey = ticketMatch[1];

        // Look for "mentioned here" link in the same line
        const linkMatch = line.match(/◦\s*Mentioned\s+(?:here)?(?:\s*:?\s*)?<([^|>]+)/);
        const threadLink = linkMatch ? linkMatch[1] : undefined;

        pairs.push({ ticketKey, threadLink });
      }
    }

    return pairs;
  }

  /**
   * Extract blocking keywords from text for analysis
   */
  extractBlockingKeywords(text: string): string[] {
    const keywords: string[] = [];

    for (const { pattern, keyword } of BLOCKING_KEYWORD_PATTERNS) {
      if (pattern.test(text)) {
        keywords.push(keyword);
      }
    }

    return keywords;
  }

  /**
   * Extract resolution keywords from text
   */
  extractResolutionKeywords(text: string): string[] {
    const keywords: string[] = [];

    for (const { pattern, keyword } of RESOLUTION_PATTERNS) {
      if (pattern.test(text)) {
        keywords.push(keyword);
      }
    }

    return keywords;
  }
}
