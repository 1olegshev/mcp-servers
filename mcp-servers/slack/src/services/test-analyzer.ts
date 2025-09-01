/**
 * Test Analysis Service
 * Analyze Slack auto-test results and their review status
 */

import { SlackClient } from '../clients/slack-client.js';
import { TextAnalyzer } from '../utils/analyzers.js';
import { DateUtils } from '../utils/date-utils.js';
import { TestResult, SlackMessage } from '../types/index.js';
import { extractAllMessageText, isBotMessage, parseTestResultsFromText } from '../utils/message-extractor.js';
import * as fs from 'fs';

export class TestAnalyzerService {
  // Configuration for which bots/patterns to look for
  private testBotConfig = {
    // All test bot IDs from actual detection: Cypress general, Cypress unverified, Jenkins/Playwright
    testBotIds: ['B067SLP8AR5', 'B067SMD5MAT', 'B052372DK4H'], // Cypress general, Cypress unverified, Jenkins/Playwright
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

  async analyzeTestResults(
    channel: string, 
    date?: string,
    messages?: SlackMessage[]
  ): Promise<TestResult[]> {
    // Use provided messages or fetch them with smart date range
    let messagesToAnalyze: SlackMessage[];
    if (messages) {
      messagesToAnalyze = messages;
    } else {
      const { oldest, latest } = DateUtils.getAutoTestDateRange(date, this.testBotConfig.maxLookbackDays);
      messagesToAnalyze = await this.slackClient.getChannelHistoryForDateRange(channel, oldest, latest, 1000);
    }
    
    const testResults: TestResult[] = [];

    // Debug logging to file
    const debugLog = `/tmp/slack-debug-${Date.now()}.log`;
    fs.writeFileSync(debugLog, `[DEBUG] Analyzing ${messagesToAnalyze.length} messages for test results\n`);
    fs.appendFileSync(debugLog, `[DEBUG] Date range requested: ${date || 'auto'}\n`);

    // Pre-filter to relevant test bot messages
    const relevant = (messagesToAnalyze || []).filter(m => this.isRelevantTestBot(m));
    if (relevant.length === 0) {
      fs.appendFileSync(debugLog, `[DEBUG] No relevant test bot messages found in fetched range.\n`);
    }
    // Do NOT filter to a single calendar day here; use the full fetched range (Fri-Sun on Monday or previous day otherwise)
    // Let latest-by-type logic pick the closest per-suite post in the range.
    messagesToAnalyze = relevant;
    fs.appendFileSync(debugLog, `[DEBUG] Using full fetched range; relevant messages count: ${messagesToAnalyze.length}\n`);

    for (const message of messagesToAnalyze) {
      // Log all bot messages we find
      if (isBotMessage(message)) {
        fs.appendFileSync(debugLog, `[DEBUG] Found bot message: user=${message.user}, bot_id=${(message as any).bot_id}, text="${(message.text || '').substring(0, 100)}..."\n`);
      }
      
      // Use improved bot detection
      if (!this.isRelevantTestBot(message)) {
        continue;
      }
      
      fs.appendFileSync(debugLog, `[DEBUG] Processing test bot: user=${message.user}, bot_id=${(message as any).bot_id}, timestamp=${message.ts}\n`);

      console.log(`[DEBUG] Processing test bot: user=${message.user}, bot_id=${(message as any).bot_id}`);
      
      // Extract all text from message (including blocks and attachments)
      const extractedText = extractAllMessageText(message);
      
      // Determine test type directly from bot and content
      const testType = this.determineTestTypeFromBot(message, extractedText.text);
      
      // Skip if we can't determine test type
      if (testType === 'Unknown Test') continue;
      
      const parsedResults = parseTestResultsFromText(extractedText.text);
      
      // Determine status
      let status = parsedResults.status || 'unknown';
      if (status === 'unknown') {
        // Fallback to existing analyzer
        const { status: fallbackStatus } = TextAnalyzer.analyzeTestResult(message);
        status = fallbackStatus;
      }
      // Playwright-specific fallback: attachments often carry the status text
      if ((status === 'unknown' || status === 'pending') && testType === 'Playwright') {
        const lt = (extractedText.text || '').toLowerCase();
        if (/(success|passed|🟢|green)/i.test(extractedText.text || '')) {
          status = 'passed';
        } else if (/(failed|❌)/i.test(extractedText.text || '')) {
          status = 'failed';
        } else {
          // Fetch full message details as a last resort and re-parse
          try {
            const full = await this.slackClient.getMessageDetails(channel, message.ts!);
            const fullText = extractAllMessageText(full).text || '';
            const reparsed = parseTestResultsFromText(fullText);
            if (reparsed.status === 'passed' || reparsed.status === 'failed') {
              status = reparsed.status as 'passed' | 'failed';
            }
          } catch {}
        }
      }
      // Normalize to a known set for reporting
      const normalizedStatus: 'passed' | 'failed' | 'pending' =
        status === 'passed' || status === 'failed' ? (status as 'passed' | 'failed') : 'pending';
      
      // Check for thread analysis
  const threadAnalysis = await this.checkForReview(message, channel, normalizedStatus);
  const permalink = await this.slackClient.getPermalink(channel, message.ts!);
      
      // Create enhanced result with detailed info
  let resultText = `${testType}: ${normalizedStatus.toUpperCase()}`;
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
        type: testType,
        status: normalizedStatus,
        text: resultText,
        timestamp: message.ts!,
        hasReview: threadAnalysis.hasReview,
        reviewSummary: threadAnalysis.summary,
        permalink,
      });
      
      fs.appendFileSync(debugLog, `[DEBUG] Added test result: ${JSON.stringify(testResults[testResults.length - 1])}\n`);
    }

    fs.appendFileSync(debugLog, `[DEBUG] Final results count: ${testResults.length}\n`);
    console.log(`[DEBUG] File logged to: ${debugLog}`);

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
    
    const botId = message.bot_id;
    
    // Check for known test bot IDs - this should be sufficient
    if (botId && this.testBotConfig.testBotIds.includes(botId)) {
      return true;
    }
    // Fallbacks: Some Jenkins/Playwright posts might not carry bot_id. Use username/text hints.
    const username = ((message as any).username || '').toLowerCase();
    const text = (message.text || '').toLowerCase();
    if (username.includes('jenkins') || text.includes('playwright')) {
      return true;
    }
    // Allow unverified cypress by text hints as a safety net
    if (text.includes('qa-unverified') || text.includes('frontend-qa-unverified')) {
      return true;
    }

    return false;
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

    // Aggregate text from message, blocks, attachments across the thread
    const collectText = (m: SlackMessage) => {
      const parts: string[] = [];
      if (m.text) parts.push(m.text);
      if ((m as any).blocks) {
        parts.push(extractAllMessageText(m).extractedFromBlocks || '');
      }
      if ((m as any).attachments) {
        parts.push(extractAllMessageText(m).extractedFromAttachments || '');
      }
      return parts.filter(Boolean).join(' ');
    };
    const threadTexts = [collectText(originalMessage), ...replies.map(collectText)];
    const allText = threadTexts.join(' ').toLowerCase();
    
    // Extract failed test names from original message and thread
    const failedTests = this.extractFailedTestNames(allText);
    
    // Analyze thread for outcomes
    const outcomes = {
      rerunSuccessful: /manual.*re[- ]?run.*pass|re[- ]?run.*(successful|success)|all.*tests.*pass|fixed|resolved|green|🟢|✅/i.test(allText),
      underInvestigation: /investigat|will.*look|looking.*into|checking|check it out|on it/i.test(allText),
      notBlocking: /not.*blocking|reviewed.*ok|approved|green.*light|not.*release.*blocker|no.*go.*removed/i.test(allText),
      stillFailing: /still.*fail|rerun.*fail|not.*fixed|issue.*persists|keeps.*failing/i.test(allText),
      revert: /revert(ed)?/i.test(allText),
      prOpened: /(https?:\/\/\S*github\.com\/\S*\/pull\/\d+)|\bPR\b|pull request|opening PR|opened PR/i.test(allText)
    } as const;

    // Build summary
    let summary = '';
    
    if (failedTests.length > 0) {
      summary += `Failed tests: ${failedTests.slice(0, 3).join(', ')}${failedTests.length > 3 ? '...' : ''}. `;
    }
    
    if (outcomes.rerunSuccessful) {
      summary += 'Manual rerun successful ✅';
      if (outcomes.prOpened) summary += ' • PR opened';
    } else if (outcomes.notBlocking) {
      summary += 'Reviewed - not blocking ✅';
      if (outcomes.prOpened) summary += ' • PR opened';
    } else if (outcomes.stillFailing) {
      summary += 'Still failing after rerun ❌';
      if (outcomes.revert) summary += ' • revert planned/applied';
    } else if (outcomes.underInvestigation) {
      summary += 'Under investigation 🔍';
      if (outcomes.prOpened) summary += ' • PR opened';
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
    // Normalize percent-encoding and slashes, then extract basenames and dedupe
    let processed = text;
    try { processed = decodeURIComponent(text); } catch {}
    processed = processed.replace(/%2F/gi, '/');
    const fileRegex = /([\w\-\/]+(?:_spec|\.spec|\.test|_test)\.[jt]sx?)/gi;
    const matches = processed.match(fileRegex) || [];
    const normalized = matches.map(m => {
      const cleaned = m.replace(/^\/*/, '');
      const base = cleaned.replace(/^.*[\\/]/, '');
      return base.replace(/^2f+/i, '');
    });
    return Array.from(new Set(normalized));
  }

  formatTestStatusReport(testResults: TestResult[], date?: string): string {
    let output = `🤖 Auto Test Status${date ? ` for ${date}` : ''}:\n\n`;

    const expectedSuites = ['Cypress (general)', 'Cypress (unverified)', 'Playwright'] as const;
    const latestByType = this.getLatestByType(testResults);

    output += `🔬 Latest Test Results:\n`;
    for (const suite of expectedSuites) {
      const test = latestByType.get(suite);
      if (test) {
        const statusIcon = test.status === 'passed' ? '✅' : test.status === 'failed' ? '❌' : '⏳';
        output += `• **${suite}**: ${statusIcon}\n`;
        if (test.permalink) {
          output += `  └─ <${test.permalink}|Open thread>\n`;
        }
        if (test.status === 'failed') {
          output += `  └─ ${test.hasReview ? test.reviewSummary : '⏳ Awaiting review'}\n`;
        }
      } else {
        output += `• **${suite}**: ❓ No recent results\n`;
      }
    }

    output += '\n';

    const present = expectedSuites
      .map(s => latestByType.get(s))
      .filter((t): t is TestResult => !!t);

    if (present.length === 0) {
      output += `❓ **AUTO TEST STATUS: NO RECENT RESULTS**\n`;
    } else {
      const allPassed = present.every(t => t.status === 'passed');
      const allReviewedOrPassed = present.every(
        t => t.status === 'passed' || (t.status === 'failed' && t.hasReview && (t.reviewSummary?.includes('✅') || /successful/i.test(t.reviewSummary || '')))
      );
      if (allPassed && present.length >= 2) {
        output += `✅ **AUTO TEST STATUS: ALL PASSED**\n`;
      } else if (allReviewedOrPassed) {
        output += `✅ **AUTO TEST STATUS: RESOLVED - NOT BLOCKING**\n`;
      } else {
        output += `⚠️ **AUTO TEST STATUS: ATTENTION REQUIRED**\n`;
      }
    }

    return output;
  }

  /**
   * Get the latest test result for each test type
   */
  private getLatestByType(testResults: TestResult[]): Map<string, TestResult> {
    const byType = new Map<string, TestResult>();
    testResults
      .slice()
      .sort((a, b) => parseFloat(b.timestamp) - parseFloat(a.timestamp))
      .forEach(result => {
        const key = this.getTestTypeFromMessage(result);
        if ((key === 'Cypress (general)' || key === 'Cypress (unverified)' || key === 'Playwright') && !byType.has(key)) {
          byType.set(key, result);
        }
      });
    return byType;
  }

  /**
   * Extract test type from message content - simplified based on bot ID
   */
  private getTestTypeFromMessage(test: TestResult): string {
    // Prefer authoritative type if already set by bot_id mapping
    if (test.type === 'Cypress (unverified)' || test.type === 'Cypress (general)' || test.type === 'Playwright') {
      return test.type;
    }
    const text = (test.text || '').toLowerCase();
    if (text.includes('frontend-qa-unverified') || text.includes('qa-unverified')) {
      return 'Cypress (unverified)';
    }
    if (text.includes('kahoot-frontend-player-qa-playwright') || 
        text.includes('frontend qa playwright') ||
        (text.includes('jenkins') && text.includes('playwright'))) {
      return 'Playwright';
    }
    if (text.includes('frontend-qa') || text.includes('cypress') || text.includes('run #')) {
      return 'Cypress (general)';
    }
    return 'Unknown Test';
  }

  /**
   * Determine test type directly from bot ID and message content
   */
  private determineTestTypeFromBot(message: SlackMessage, extractedText: string): string {
    const botId = message.bot_id;
    const text = extractedText.toLowerCase();
    
    // Direct bot ID mapping for efficiency
    if (botId === 'B067SMD5MAT') {
      return 'Cypress (unverified)';
    } else if (botId === 'B052372DK4H') {
      return 'Playwright';
    } else if (botId === 'B067SLP8AR5') {
      return 'Cypress (general)';
    }
    
    // Fallback to text analysis
    if (text.includes('frontend-qa-unverified') || text.includes('qa-unverified')) {
      return 'Cypress (unverified)';
    } else if (text.includes('kahoot-frontend-player-qa-playwright') || 
               text.includes('frontend qa playwright')) {
      return 'Playwright';
    } else if (text.includes('frontend-qa') || text.includes('cypress')) {
      return 'Cypress (general)';
    }
    
    return 'Unknown Test';
  }

  /**
   * Search for messages from known test bots for a specific date
   */
  private async getTestBotMessages(channel: string, date?: string): Promise<SlackMessage[]> {
    const messages: SlackMessage[] = [];
    const targetDate = date || new Date().toISOString().split('T')[0];
    
    // Search for each test bot individually
    for (const botId of this.testBotConfig.testBotIds) {
      try {
        const query = `from:<@${botId}> after:${targetDate}`;
        const results = await this.slackClient.searchMessages(query, channel);
        
        // Convert search results to SlackMessage format and add to collection
        for (const result of results) {
          if (result.ts && result.text !== undefined) {
            messages.push({
              type: 'message',
              ts: result.ts,
              user: result.user || botId,
              bot_id: botId,
              text: result.text || '',
              ...result
            } as SlackMessage);
          }
        }
      } catch (error) {
        console.warn(`Failed to search for bot ${botId}:`, error);
      }
    }
    
    // Sort by timestamp (newest first)
    messages.sort((a, b) => parseFloat(b.ts!) - parseFloat(a.ts!));
    
    return messages;
  }
}