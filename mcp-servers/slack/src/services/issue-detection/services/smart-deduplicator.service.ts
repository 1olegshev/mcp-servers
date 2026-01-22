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

    const severityRank = (issue: Issue): number => {
      if (issue.type === 'blocking') return 0;
      if (issue.type === 'blocking_resolved') return 1;
      return 2;
    };

    const minSeverity = Math.min(...issues.map(severityRank));
    let candidates = issues.filter(issue => severityRank(issue) === minSeverity);

    if (candidates.length === 0) {
      candidates = issues;
    }

    // Hotfix commitment takes precedence when severity is equal
    const hotfixCandidates = candidates.filter(issue => issue.hotfixCommitment);
    if (hotfixCandidates.length > 0) {
      candidates = hotfixCandidates;
    }

    // Priority 1: Issues with thread context and permalinks
    const withThreadAndPermalink = candidates.filter(
      issue => issue.hasThread && issue.permalink
    );
    if (withThreadAndPermalink.length > 0) {
      return this.selectMostRecent(withThreadAndPermalink);
    }

    // Priority 2: Issues with thread context only
    const withThreadOnly = candidates.filter(
      issue => issue.hasThread && !issue.permalink
    );
    if (withThreadOnly.length > 0) {
      return this.selectMostRecent(withThreadOnly);
    }

    // Priority 3: Issues with permalinks only
    const withPermalinkOnly = candidates.filter(
      issue => !issue.hasThread && issue.permalink
    );
    if (withPermalinkOnly.length > 0) {
      return this.selectMostRecent(withPermalinkOnly);
    }

    // Priority 4: List-only issues (no thread, no permalink)
    const listOnly = candidates.filter(
      issue => !issue.hasThread && !issue.permalink
    );
    if (listOnly.length > 0) {
      return this.selectMostRecent(listOnly);
    }

    // Fallback: just return the first one
    return candidates[0];
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
}
