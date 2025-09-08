/**
 * Blocker Pattern Service
 * Handles text pattern matching and ticket extraction
 * Extracted from the monolithic IssueDetectorService
 */

import { TextAnalyzer } from '../../../utils/analyzers.js';
import { JiraTicketInfo } from '../../../types/index.js';
import { IPatternMatcher, TicketContext } from '../models/service-interfaces.js';

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

    // Accept explicit signals or release/deploy contexts only; avoid generic 'blocks' (e.g., UI blocks)
    const explicit = /\b(blocker|blocking)\b/i.test(text) || /release\s*blocker/i.test(text);
    const releaseContext = /(\bblock(s)?\b|\bblocking\b).*\b(release|deploy(?:ment)?|prod(?:uction)?)\b/i.test(lowerText);
    const noGo = /no[-_\s]?go/i.test(lowerText);

    return lowerText.includes('@test-managers') || lowerText.includes('hotfix') || explicit || releaseContext || noGo;
  }

  /**
   * Check if text contains critical indicators
   */
  hasCriticalIndicators(text: string): boolean {
    const lower = (text || '').toLowerCase();

    // Negative/mitigating signals (any of these should cancel a positive match)
    const negativeSignals = [
      /\bnot\s+(a\s+)?(super\s+)?high\s+priority\b/i,
      /\bnot\s+urgent\b/i,
      /\bnot\s+critical\b/i,
      /\blow\s+priority\b/i,
      /\bno\s+need\s+to\s+tackle\s+immediately\b/i,
      /\bnot\s+.*tackle\s+immediately\b/i,
      /\bnot\s+immediate(ly)?\b/i,
    ];

    const hasNegative = negativeSignals.some(re => re.test(lower));

    // Positive signals
    const positiveSignals = [
      // "this is critical" / "critical issue" / standalone critical (but not within "not critical")
      /\bcritical(?!\s*path)\b/i,
      /\burgent\b/i,
      /\bhigh\s+priority\b/i,
    ];

    const hasPositive = positiveSignals.some(re => re.test(lower));

    // Only treat as critical if there's a positive indicator and no negation nearby
    if (!hasPositive) return false;
    if (hasNegative) return false;

    // Additional windowed negation check: "not ... (critical|urgent|high priority)" within ~4 words
    const windowNegation = /\b(?:not|isn['']?t|no|doesn['']?t(?:\s+have)?)\b(?:\W+\w+){0,4}\W+(?:critical|urgent|high\s+priority)\b/i.test(lower);
    if (windowNegation) return false;

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
   * e.g., "Blockers: • TICKET-123 • TICKET-456" or "Blockers:\n- TICKET-123\n- TICKET-456"
   */
  parseBlockerList(text: string): TicketContext[] {
    const tickets: TicketContext[] = [];

    // Look for explicit blocker lists
    if (/\bblockers?\b.*:/i.test(text) || /blockers?\s*for/i.test(text)) {
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
        const linkMatch = line.match(/◦\s*Mentioned\s*<([^|>]+)/);
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
    const lowerText = text.toLowerCase();

    const blockingPatterns = [
      { pattern: /\bblocker\b/i, keyword: 'blocker' },
      { pattern: /\bblocking\b/i, keyword: 'blocking' },
      { pattern: /release\s*blocker/i, keyword: 'release blocker' },
      { pattern: /\bblocks?\b/i, keyword: 'blocks' },
      { pattern: /no.?go/i, keyword: 'no-go' },
      { pattern: /@test.managers/i, keyword: 'test-managers' },
      { pattern: /hotfix/i, keyword: 'hotfix' }
    ];

    for (const { pattern, keyword } of blockingPatterns) {
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

    const resolutionPatterns = [
      { pattern: /\bresolved\b/i, keyword: 'resolved' },
      { pattern: /\bfixed\b/i, keyword: 'fixed' },
      { pattern: /\bready\b/i, keyword: 'ready' },
      { pattern: /\bdeployed\b/i, keyword: 'deployed' },
      { pattern: /not.*blocking/i, keyword: 'not blocking' },
      { pattern: /no.*longer.*blocking/i, keyword: 'no longer blocking' },
      { pattern: /\bnot a blocker\b/i, keyword: 'not a blocker' }
    ];

    for (const { pattern, keyword } of resolutionPatterns) {
      if (pattern.test(text)) {
        keywords.push(keyword);
      }
    }

    return keywords;
  }
}
