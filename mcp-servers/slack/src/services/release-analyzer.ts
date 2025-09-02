/**
 * Release Analysis Service
 * Provides comprehensive release status analysis
 */

import { IssueDetectorService } from './issue-detector.js';
import { TestAnalyzerService } from './test-analyzer.js';
import { DateUtils } from '../utils/date-utils.js';
import { SlackClient } from '../clients/slack-client.js';

export class ReleaseAnalyzerService {
  constructor(
    private slackClient: SlackClient,
    private issueDetector: IssueDetectorService,
    private testAnalyzer: TestAnalyzerService
  ) {}

  async generateReleaseOverview(channel: string, date?: string): Promise<string> {
    const targetDate = date || DateUtils.getTodayDateString();
    
    // Fetch issues using day-bounded messages for precision, but let test analyzer choose its own smart lookback
    const { oldest, latest } = DateUtils.getDateRange(date);
    const dayMessages = await this.slackClient.getChannelHistoryForDateRange(channel, oldest, latest, 200);
    
    const [allIssues, testResults] = await Promise.all([
      this.issueDetector.findIssues(channel, date, 'both', dayMessages),
      this.testAnalyzer.analyzeTestResults(channel, date)
    ]);
    
    // Separate issues by their new, nuanced types
    const blockingIssues = allIssues.filter(i => i.type === 'blocking');
    const criticalIssues = allIssues.filter(i => i.type === 'critical');
    const resolvedBlockers = allIssues.filter(i => i.type === 'blocking_resolved');
    
    return this.formatOverview(targetDate, blockingIssues, criticalIssues, resolvedBlockers, testResults, channel);
  }

  private formatOverview(
    targetDate: string, 
    blockingIssues: any[], 
    criticalIssues: any[], 
    resolvedBlockers: any[],
    testResults: any[], 
    channel: string
  ): string {
    // Determine status based on nuanced issue types
    const hasBlockingIssues = blockingIssues.length > 0;
    const hasCriticalIssues = criticalIssues.length > 0;
    const hasResolvedBlockers = resolvedBlockers.length > 0;
    
  const autoTestsAllPassed = testResults.length > 0 && testResults.every((t: any) => t.status === 'passed');
    const autoTestsReviewed = testResults
      .filter((t: any) => t.status === 'failed')
      .every((t: any) => t.hasReview && t.reviewSummary?.includes('not blocking'));
    const autoTestsPending = testResults.some((t: any) => 
      t.status === 'failed' && (!t.hasReview || !t.reviewSummary?.includes('not blocking'))
    );

    // Determine overall status
    let overallStatus = 'READY';
    let statusEmoji = '🟢';
    
    if (hasBlockingIssues) {
      overallStatus = 'BLOCKED';
      statusEmoji = '🔴';
    } else if (autoTestsPending || hasCriticalIssues || hasResolvedBlockers) {
      overallStatus = 'UNCERTAIN';
      statusEmoji = '🟡';
    }

    // Generate report
    let output = `🚦 RELEASE STATUS OVERVIEW - ${targetDate.toUpperCase()}\n`;
    output += `${statusEmoji} STATUS: ${overallStatus}\n\n`;
    
    output += `📊 AUTO TESTS:\n`;
    if (autoTestsAllPassed) {
      output += `✅ All auto tests passed\n`;
    } else if (autoTestsReviewed) {
      output += `✅ Failed tests reviewed and approved\n`;
    } else if (autoTestsPending) {
      output += `⚠️ Failed tests pending review\n`;
    } else {
      output += `❓ Auto test status unclear\n`;
    }
    output += '\n';
    
    if (hasBlockingIssues) {
      output += `🚨 BLOCKING ISSUES FOUND:\n`;
      blockingIssues.slice(0, 5).forEach((issue: any, i: any) => {
        output += `${i + 1}. ${issue.text}\n`;
        if (issue.tickets.length > 0) {
          output += `   Tickets: ${issue.tickets.map((t: any) => t.key).join(', ')}\n`;
        }
      });
      output += '\n';
    }
    
    if (hasResolvedBlockers) {
      output += `🟠 MITIGATED BLOCKERS (Review Recommended):\n`;
      resolvedBlockers.slice(0, 5).forEach((issue: any, i: any) => {
        output += `${i + 1}. ${issue.text}\n`;
        if (issue.resolutionText) {
          output += `   Resolution: "${issue.resolutionText.trim()}"\n`;
        }
      });
      output += '\n';
    }
    
    if (hasCriticalIssues) {
      output += `⚠️ CRITICAL ISSUES FOUND:\n`;
      criticalIssues.slice(0, 5).forEach((issue: any, i: any) => {
        output += `${i + 1}. ${issue.text}\n`;
        if (issue.tickets.length > 0) {
          output += `   Tickets: ${issue.tickets.map((t: any) => t.key).join(', ')}\n`;
        }
      });
      output += '\n';
    }
    
    // Recommendation
    output += `📋 RECOMMENDATION:\n`;
    if (overallStatus === 'READY') {
      output += `✅ Release can proceed - no active blockers detected\n`;
    } else if (overallStatus === 'BLOCKED') {
      output += `❌ Release should be postponed - active blocking issues need resolution\n`;
    } else {
      output += `⚠️ Release decision pending - review critical issues and mitigated blockers\n`;
    }
    
    output += `\n📅 Analysis Date: ${targetDate}\n`;
    output += `📺 Channel: #${channel}\n`;

    return output;
  }
}