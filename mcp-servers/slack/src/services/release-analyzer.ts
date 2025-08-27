/**
 * Release Analysis Service
 * Provides comprehensive release status analysis
 */

import { IssueDetectorService } from './issue-detector.js';
import { TestAnalyzerService } from './test-analyzer.js';
import { DateUtils } from '../utils/date-utils.js';

export class ReleaseAnalyzerService {
  constructor(
    private issueDetector: IssueDetectorService,
    private testAnalyzer: TestAnalyzerService
  ) {}

  async generateReleaseOverview(channel: string, date?: string): Promise<string> {
    const targetDate = date || DateUtils.getTodayDateString();
    
    // Get all analysis results
    const [blockingIssues, criticalIssues, testResults] = await Promise.all([
      this.issueDetector.findIssues(channel, date, 'blocking'),
      this.issueDetector.findIssues(channel, date, 'critical'),
      this.testAnalyzer.analyzeTestResults(channel, date)
    ]);

    // Determine status
    const hasBlockingIssues = blockingIssues.length > 0;
    const hasCriticalIssues = criticalIssues.length > 0;
    const autoTestsAllPassed = testResults.every(t => t.status === 'passed');
    const autoTestsReviewed = testResults
      .filter(t => t.status === 'failed')
      .every(t => t.hasReview && t.reviewSummary?.includes('not blocking'));
    const autoTestsPending = testResults.some(t => 
      t.status === 'failed' && (!t.hasReview || !t.reviewSummary?.includes('not blocking'))
    );

    // Determine overall status
    let overallStatus = 'READY';
    let statusEmoji = '🟢';
    
    if (hasBlockingIssues) {
      overallStatus = 'BLOCKED';
      statusEmoji = '🔴';
    } else if (autoTestsPending || hasCriticalIssues) {
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
      blockingIssues.slice(0, 5).forEach((issue, i) => {
        output += `${i + 1}. ${issue.text}\n`;
        if (issue.tickets.length > 0) {
          output += `   Tickets: ${issue.tickets.map(t => t.key).join(', ')}\n`;
        }
      });
      output += '\n';
    }
    
    if (hasCriticalIssues) {
      output += `⚠️ CRITICAL ISSUES FOUND:\n`;
      criticalIssues.slice(0, 5).forEach((issue, i) => {
        output += `${i + 1}. ${issue.text}\n`;
        if (issue.tickets.length > 0) {
          output += `   Tickets: ${issue.tickets.map(t => t.key).join(', ')}\n`;
        }
      });
      output += '\n';
    }
    
    // Recommendation
    output += `📋 RECOMMENDATION:\n`;
    if (overallStatus === 'READY') {
      output += `✅ Release can proceed - no blockers detected\n`;
    } else if (overallStatus === 'BLOCKED') {
      output += `❌ Release should be postponed - blocking issues need resolution\n`;
    } else {
      output += `⚠️ Release decision pending - review critical issues and auto test failures\n`;
    }
    
    output += `\n📅 Analysis Date: ${targetDate}\n`;
    output += `📺 Channel: #${channel}\n`;

    return output;
  }
}