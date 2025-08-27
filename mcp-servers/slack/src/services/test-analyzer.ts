/**
 * Test Analysis Service
 * Analyzes auto test results and their review status
 */

import { SlackClient } from '../clients/slack-client.js';
import { TextAnalyzer } from '../utils/analyzers.js';
import { DateUtils } from '../utils/date-utils.js';
import { TestResult, SlackMessage } from '../types/index.js';
import { extractAllMessageText, isBotMessage, parseTestResultsFromText } from '../utils/message-extractor.js';

export class TestAnalyzerService {
  // Configuration for which bots/patterns to look for
  private testBotConfig = {
    // Specific bot user IDs and patterns (updated from actual bot detection)
    cypressBotIds: ['B067SLP8AR5', 'B067SMD5MAT', 'U067SLGMJDD'], // Updated with actual Cypress bot IDs
    jenkinsPattern: 'kahoot-frontend-player-qa-playwright',
    
    // Early morning cutoff for "current date" consideration
    earlyMorningCutoff: 1, // 1:00 AM
    
    // Lookback range for finding tests
    maxLookbackDays: 7,
    
    // Test result patterns for detection (updated to match actual format)
    testResultPatterns: [
      'run #\\d+',
      'test results:',
      'failed run',
      'frontend-qa',
      'kahoot-frontend-player-qa-playwright',
      'failed.*test',
      'passed.*test',
      'specs for review'
    ]
  };

  constructor(private slackClient: SlackClient) {}

  async analyzeTestResults(channel: string, date?: string): Promise<TestResult[]> {
    // Use smart date range for auto-test lookback
    const { oldest, latest } = DateUtils.getAutoTestDateRange(date, this.testBotConfig.maxLookbackDays);
    const messages = await this.slackClient.getChannelHistoryForDateRange(channel, oldest, latest);
    
    const testResults: TestResult[] = [];

    for (const message of messages) {
      // Use improved bot detection
      if (!this.isRelevantTestBot(message)) continue;
      
      // Extract all text from message (including blocks and attachments)
      const extractedText = extractAllMessageText(message);
      const parsedResults = parseTestResultsFromText(extractedText.text);
      
      // Skip if we can't determine test type
      if (!parsedResults.testType) continue;
      
      // Determine status
      let status = parsedResults.status || 'unknown';
      if (status === 'unknown') {
        // Fallback to existing analyzer
        const { status: fallbackStatus } = TextAnalyzer.analyzeTestResult(message);
        status = fallbackStatus;
      }
      
      if (parsedResults.testType !== 'unknown') {
        // Check for thread analysis
        const threadAnalysis = await this.checkForReview(message, channel, status);
        
        // Create enhanced result with detailed info
        let resultText = `${parsedResults.testType}: ${status.toUpperCase()}`;
        if (parsedResults.runNumber) {
          resultText += ` (Run #${parsedResults.runNumber})`;
        }
        if (parsedResults.failedTests.length > 0) {
          resultText += `\nFailed tests: ${parsedResults.failedTests.slice(0, 3).join(', ')}`;
          if (parsedResults.failedTests.length > 3) {
            resultText += ` +${parsedResults.failedTests.length - 3} more`;
          }
        }
        
        // Add extraction info for debugging
        if (extractedText.hasBlocks || extractedText.hasAttachments) {
          resultText += `\n[Extracted from: ${extractedText.hasBlocks ? 'blocks' : ''}${extractedText.hasBlocks && extractedText.hasAttachments ? ', ' : ''}${extractedText.hasAttachments ? 'attachments' : ''}]`;
        }
        
        testResults.push({
          type: parsedResults.testType,
          status: status as 'passed' | 'failed' | 'pending',
          text: resultText,
          timestamp: message.ts!,
          hasReview: threadAnalysis.hasReview,
          reviewSummary: threadAnalysis.summary,
        });
      }
    }

    return testResults;
  }

  /**
   * Improved bot detection specifically for test automation
   */
  private isRelevantTestBot(message: SlackMessage): boolean {
    // First check if it's a bot message at all
    if (!isBotMessage(message)) {
      return false;
    }
    
    const userId = message.user;
    const username = (message.username || message.bot_profile?.name || '').toLowerCase();
    
    // Extract all text for analysis
    const extractedText = extractAllMessageText(message);
    const text = extractedText.text.toLowerCase();
    
    // Check for specific Cypress bot IDs (if user/bot_id is available)
    if (userId && this.testBotConfig.cypressBotIds.includes(userId)) {
      return true;
    }
    
    // Also check bot_id from bot_profile
    const botId = message.bot_id;
    if (botId && this.testBotConfig.cypressBotIds.includes(botId)) {
      return true;
    }
    
    // Check for Cypress patterns based on actual message format
    if (text.includes('run #') && (
        text.includes('frontend-qa') || 
        text.includes('cypress') ||
        text.includes('failed run') ||
        text.includes('test results:'))) {
      return true;
    }
    
    // Check for Jenkins with specific pattern
    if ((username.includes('jenkins') || text.includes('jenkins')) && 
        text.includes(this.testBotConfig.jenkinsPattern)) {
      return true;
    }
    
    // Check for Jenkins with Playwright pattern
    if (text.includes('kahoot-frontend-player-qa-playwright')) {
      return true;
    }
    
    // Fallback: Check against test result patterns in message text
    const hasTestPattern = this.testBotConfig.testResultPatterns.some(pattern => 
      new RegExp(pattern, 'i').test(text)
    );
    
    return hasTestPattern;
  }

  private async checkForReview(
    message: SlackMessage, 
    channel: string, 
    status: string
  ): Promise<{ hasReview: boolean; summary: string }> {
    if (status !== 'failed' || !(message.thread_ts || (message.reply_count || 0) > 0)) {
      return { hasReview: false, summary: '' };
    }

    try {
      const replies = await this.slackClient.getThreadReplies(channel, message.ts!);
      const analysis = this.analyzeThreadContent(replies, message);
      
      return {
        hasReview: analysis.hasActivity,
        summary: analysis.summary
      };
    } catch (error) {
      console.error('Failed to check test review:', error);
    }

    return { hasReview: false, summary: '' };
  }

  /**
   * Analyze thread content for test outcomes and investigation status
   */
  private analyzeThreadContent(replies: SlackMessage[], originalMessage: SlackMessage): { hasActivity: boolean; summary: string } {
    if (replies.length === 0) {
      return { hasActivity: false, summary: '' };
    }

    const allText = [originalMessage.text || '', ...replies.map(r => r.text || '')].join(' ').toLowerCase();
    
    // Extract failed test names from original message and thread
    const failedTests = this.extractFailedTestNames(allText);
    
    // Analyze thread for outcomes
    const outcomes = {
      rerunSuccessful: /manual.*rerun.*passed|rerun.*successful|all.*tests.*passed/i.test(allText),
      underInvestigation: /investigating|will.*look|looking.*into|checking/i.test(allText),
      notBlocking: /not.*blocking|reviewed.*ok|approved|green.*light/i.test(allText),
      stillFailing: /still.*fail|rerun.*failed|not.*fixed/i.test(allText)
    };

    // Build summary
    let summary = '';
    
    if (failedTests.length > 0) {
      summary += `Failed tests: ${failedTests.slice(0, 3).join(', ')}${failedTests.length > 3 ? '...' : ''}. `;
    }
    
    if (outcomes.rerunSuccessful) {
      summary += 'Manual rerun successful ✅';
    } else if (outcomes.notBlocking) {
      summary += 'Reviewed - not blocking ✅';
    } else if (outcomes.stillFailing) {
      summary += 'Still failing after rerun ❌';
    } else if (outcomes.underInvestigation) {
      summary += 'Under investigation 🔍';
    } else {
      summary += 'Thread activity - status unclear';
    }

    return {
      hasActivity: true,
      summary: summary.trim()
    };
  }

  /**
   * Extract specific test file names from text
   */
  private extractFailedTestNames(text: string): string[] {
    const testPatterns = [
      /([a-zA-Z0-9_-]+\.spec\.[jt]s)/g,
      /([a-zA-Z0-9_-]+_spec\.[jt]s)/g,
      /([a-zA-Z0-9_-]+\.test\.[jt]s)/g,
      /([a-zA-Z0-9_-]+_test\.[jt]s)/g
    ];

    const tests = new Set<string>();
    
    for (const pattern of testPatterns) {
      const matches = text.match(pattern);
      if (matches) {
        matches.forEach(match => tests.add(match));
      }
    }

    return Array.from(tests);
  }

  formatTestStatusReport(testResults: TestResult[], date?: string): string {
    let output = `🤖 Auto Test Status${date ? ` for ${date}` : ''}:\n\n`;
    
    // Group by test type and get the most recent of each
    const latestResults = this.getLatestTestResults(testResults);
    
    if (latestResults.length === 0) {
      output += `❌ No auto-test results found in lookback period\n`;
      return output;
    }
    
    output += `🔬 Latest Test Results:\n`;
    
    for (const test of latestResults) {
      const statusIcon = test.status === 'passed' ? '✅' : '❌';
      const testType = this.getTestTypeFromMessage(test);
      
      output += `• **${testType}**: ${statusIcon}\n`;
      
      if (test.status === 'failed' && test.hasReview) {
        output += `  └─ ${test.reviewSummary}\n`;
      } else if (test.status === 'failed') {
        output += `  └─ ⏳ Awaiting review\n`;
      }
    }
    
    output += '\n';
    
    // Overall assessment
    const allPassed = latestResults.every(t => t.status === 'passed');
    const allReviewedOrPassed = latestResults.every(t => 
      t.status === 'passed' || 
      (t.hasReview && (t.reviewSummary?.includes('✅') || t.reviewSummary?.includes('successful')))
    );
    
    if (allPassed) {
      output += `✅ **AUTO TEST STATUS: ALL PASSED**\n`;
    } else if (allReviewedOrPassed) {
      output += `✅ **AUTO TEST STATUS: RESOLVED - NOT BLOCKING**\n`;
    } else {
      output += `⚠️ **AUTO TEST STATUS: ATTENTION REQUIRED**\n`;
    }

    return output;
  }

  /**
   * Get the latest test result for each test type
   */
  private getLatestTestResults(testResults: TestResult[]): TestResult[] {
    const resultMap = new Map<string, TestResult>();
    
    // Sort by timestamp (newest first) and keep the latest of each type
    testResults
      .sort((a, b) => parseFloat(b.timestamp) - parseFloat(a.timestamp))
      .forEach(result => {
        const testType = this.getTestTypeFromMessage(result);
        if (!resultMap.has(testType)) {
          resultMap.set(testType, result);
        }
      });
    
    return Array.from(resultMap.values());
  }

  /**
   * Extract test type from message content
   */
  private getTestTypeFromMessage(test: TestResult): string {
    const text = test.text.toLowerCase();
    
    if (text.includes('frontend-qa-unverified')) {
      return 'Cypress (frontend-qa-unverified)';
    } else if (text.includes('frontend-qa')) {
      return 'Cypress (frontend-qa)';
    } else if (text.includes('kahoot-frontend-player-qa-playwright')) {
      return 'Jenkins (playwright)';
    } else if (text.includes('cypress')) {
      return 'Cypress (general)';
    } else if (text.includes('playwright')) {
      return 'Playwright';
    }
    
    return test.type || 'Unknown Test';
  }
}