/**
 * Smart Deduplicator Service
 * Handles duplicate detection and prioritization for issues
 * Extracted from the monolithic IssueDetectorService
 */

import { Issue } from '../../../types/index.js';
import { IDeduplicator } from '../models/service-interfaces.js';

export class SmartDeduplicatorService implements IDeduplicator {
  /**
   * Deduplicate issues with priority rules:
   * - Prefer issues with thread context over list-only issues
   * - Maintain thread links and permalinks
   */
  deduplicateWithPriority(issues: Issue[]): Issue[] {
    // Group issues by ticket key
    const ticketToIssues = new Map<string, Issue[]>();

    for (const issue of issues) {
      for (const ticket of issue.tickets) {
        if (!ticketToIssues.has(ticket.key)) {
          ticketToIssues.set(ticket.key, []);
        }
        ticketToIssues.get(ticket.key)!.push(issue);
      }
    }

    const dedupedIssues: Issue[] = [];

    // For each ticket, select the best issue
    for (const [ticketKey, ticketIssues] of ticketToIssues) {
      const bestIssue = this.selectBestIssue(ticketIssues);
      if (bestIssue) {
        dedupedIssues.push(bestIssue);
      }
    }

    return dedupedIssues;
  }

  /**
   * Select the best issue for a ticket based on priority rules
   */
  private selectBestIssue(issues: Issue[]): Issue | null {
    if (issues.length === 0) return null;
    if (issues.length === 1) return issues[0];

    // Priority 1: Issues with thread context and permalinks
    const withThreadAndPermalink = issues.filter(
      issue => issue.hasThread && issue.permalink
    );
    if (withThreadAndPermalink.length > 0) {
      return this.selectMostRecent(withThreadAndPermalink);
    }

    // Priority 2: Issues with thread context only
    const withThreadOnly = issues.filter(
      issue => issue.hasThread && !issue.permalink
    );
    if (withThreadOnly.length > 0) {
      return this.selectMostRecent(withThreadOnly);
    }

    // Priority 3: Issues with permalinks only
    const withPermalinkOnly = issues.filter(
      issue => !issue.hasThread && issue.permalink
    );
    if (withPermalinkOnly.length > 0) {
      return this.selectMostRecent(withPermalinkOnly);
    }

    // Priority 4: List-only issues (no thread, no permalink)
    const listOnly = issues.filter(
      issue => !issue.hasThread && !issue.permalink
    );
    if (listOnly.length > 0) {
      return this.selectMostRecent(listOnly);
    }

    // Fallback: just return the first one
    return issues[0];
  }

  /**
   * Select the most recent issue from a list
   */
  private selectMostRecent(issues: Issue[]): Issue {
    return issues.reduce((mostRecent, current) => {
      const mostRecentTime = new Date(mostRecent.timestamp).getTime();
      const currentTime = new Date(current.timestamp).getTime();
      return currentTime > mostRecentTime ? current : mostRecent;
    });
  }

  /**
   * Merge duplicate issues intelligently
   * Combines information from multiple sources
   */
  mergeDuplicateIssues(issues: Issue[]): Issue {
    if (issues.length === 1) return issues[0];

    const primary = this.selectBestIssue(issues);
    if (!primary) throw new Error('No primary issue found');

    // Merge tickets (remove duplicates)
    const allTickets = issues.flatMap(issue => issue.tickets);
    const uniqueTickets = this.deduplicateTickets(allTickets);

    // Combine context text
    const contextTexts = issues
      .map(issue => issue.text)
      .filter(text => text && text.length > 0);

    const combinedText = this.combineContextTexts(contextTexts);

    return {
      ...primary,
      tickets: uniqueTickets,
      text: combinedText,
      // Keep the best permalink/thread info
      hasThread: issues.some(issue => issue.hasThread),
      permalink: primary.permalink || issues.find(issue => issue.permalink)?.permalink
    };
  }

  /**
   * Remove duplicate tickets based on key
   */
  private deduplicateTickets(tickets: any[]): any[] {
    const seen = new Set<string>();
    return tickets.filter(ticket => {
      if (seen.has(ticket.key)) return false;
      seen.add(ticket.key);
      return true;
    });
  }

  /**
   * Combine multiple context texts intelligently
   */
  private combineContextTexts(texts: string[]): string {
    if (texts.length === 0) return '';
    if (texts.length === 1) return texts[0];

    // Take the longest text as primary
    const sortedByLength = texts.sort((a, b) => b.length - a.length);
    const primaryText = sortedByLength[0];

    // If the primary is much longer, use it alone
    if (primaryText.length > 200) {
      return primaryText.substring(0, 200) + '...';
    }

    // Otherwise, combine unique information
    const combined = this.mergeUniqueInformation(texts);
    return combined.substring(0, 200) + (combined.length > 200 ? '...' : '');
  }

  /**
   * Merge unique information from multiple texts
   */
  private mergeUniqueInformation(texts: string[]): string {
    const sentences = new Set<string>();

    for (const text of texts) {
      // Split into sentences and add unique ones
      const textSentences = text.split(/[.!?]+/).map(s => s.trim()).filter(s => s.length > 0);
      textSentences.forEach(sentence => sentences.add(sentence));
    }

    return Array.from(sentences).join('. ') + '.';
  }

  /**
   * Check if two issues are duplicates
   */
  areDuplicates(issue1: Issue, issue2: Issue): boolean {
    // Same ticket keys
    const ticketKeys1 = new Set(issue1.tickets.map(t => t.key));
    const ticketKeys2 = new Set(issue2.tickets.map(t => t.key));

    // Check if they share any ticket keys
    for (const key of ticketKeys1) {
      if (ticketKeys2.has(key)) return true;
    }

    return false;
  }

  /**
   * Group issues by shared tickets
   */
  groupBySharedTickets(issues: Issue[]): Issue[][] {
    const groups: Issue[][] = [];
    const processed = new Set<Issue>();

    for (const issue of issues) {
      if (processed.has(issue)) continue;

      const group = [issue];
      processed.add(issue);

      for (const otherIssue of issues) {
        if (processed.has(otherIssue)) continue;

        if (this.areDuplicates(issue, otherIssue)) {
          group.push(otherIssue);
          processed.add(otherIssue);
        }
      }

      groups.push(group);
    }

    return groups;
  }
}
