/**
 * Test Analysis Service
 * Analyze Slack auto-test results and their review status
 */

import { SlackClient } from '../clients/slack-client.js';
import { TextAnalyzer } from '../utils/analyzers.js';
import { DateUtils } from '../utils/date-utils.js';
import { TestResult, SlackMessage } from '../types/index.js';
import { extractAllMessageText, isBotMessage, parseTestResultsFromText } from '../utils/message-extractor.js';
// Note: Removed file-based debug logging for cleaner runtime

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
    // Helper: date math and query builders
    const startOfToday = (() => {
      const d = date ? new Date(date) : new Date();
      const n = new Date(d);
      n.setHours(0, 0, 0, 0);
      return n;
    })();

    const fmtDate = (d: Date) => d.toISOString().split('T')[0];
    const addDays = (d: Date, delta: number) => new Date(d.getTime() + delta * 24 * 60 * 60 * 1000);
    const beforeDateStr = fmtDate(startOfToday);

    // Build phase windows
    const dayOfWeek = (date ? new Date(date) : new Date()).getDay(); // 0 Sun, 1 Mon
    const phase1Dates: string[] = [];
    if (dayOfWeek === 1) {
      // Monday: try Sun -> Sat -> Fri
      phase1Dates.push(fmtDate(addDays(startOfToday, -1))); // Sunday
      phase1Dates.push(fmtDate(addDays(startOfToday, -2))); // Saturday
      phase1Dates.push(fmtDate(addDays(startOfToday, -3))); // Friday
    } else {
      // Other days: yesterday only
      phase1Dates.push(fmtDate(addDays(startOfToday, -1)));
    }
    const phase2After = fmtDate(addDays(startOfToday, -this.testBotConfig.maxLookbackDays));

    // Suites mapping
    const suiteBots: Array<{ id: string; name: 'Cypress (general)' | 'Cypress (unverified)' | 'Playwright' }> = [
      { id: 'B067SLP8AR5', name: 'Cypress (general)' },
      { id: 'B067SMD5MAT', name: 'Cypress (unverified)' },
      { id: 'B052372DK4H', name: 'Playwright' },
    ];

    const found: Map<string, SlackMessage> = new Map();

    // Helper: run a per-bot search within [after,before) date bounds and pick newest < startOfToday
    const findBySearch = async (suite: 'Cypress (general)' | 'Cypress (unverified)' | 'Playwright', after: string, before: string): Promise<SlackMessage | undefined> => {
      let query = '';
      if (suite === 'Playwright') {
        // Confirmed handle for Jenkins user
        query = `from:@jenkins2 after:${after} before:${before}`;
      } else {
        // Use app name and then narrow by text anchors
        query = `from:Cypress after:${after} before:${before}`;
      }
      const matches = await this.slackClient.searchMessages(query, channel);
      // matches already sorted desc per client
      for (const m of matches) {
        if (!m.ts) continue;
        // Ensure it's before today
        if (parseFloat(m.ts) * 1000 >= startOfToday.getTime()) continue;
        try {
          const full = await this.slackClient.getMessageDetails(channel, m.ts);
          const text = (extractAllMessageText(full).text || '').toLowerCase();
          // Narrow by suite-specific anchors
          if (suite === 'Playwright') {
            if (text.includes('kahoot-frontend-player-qa-playwright') || /frontend\s+qa\s+playwright/.test(text) || /playwright/.test(text)) {
              return full as SlackMessage;
            }
          } else if (suite === 'Cypress (unverified)') {
            if (text.includes('qa-unverified') || text.includes('frontend-qa-unverified')) {
              return full as SlackMessage;
            }
          } else {
            if (text.includes('frontend-qa') || text.includes('cypress') || /run\s*#/.test(text) || text.includes('test results')) {
              return full as SlackMessage;
            }
          }
        } catch {
          continue;
        }
      }
      return undefined;
    };

    // Phase 1: minimal probes (yesterday or Sun->Sat->Fri)
    for (const dStr of phase1Dates) {
      // Search per suite if not yet found
      await Promise.all(
        suiteBots.map(async ({ id, name }) => {
          if (found.has(name)) return;
          const msg = await findBySearch(name, dStr, beforeDateStr);
          if (msg) found.set(name, msg);
        })
      );
      if (found.size === suiteBots.length) break;
    }

    // Phase 2: broader 7-day fallback
    if (found.size < suiteBots.length) {
      await Promise.all(
        suiteBots.map(async ({ id, name }) => {
          if (found.has(name)) return;
          const msg = await findBySearch(name, phase2After, beforeDateStr);
          if (msg) found.set(name, msg);
        })
      );
    }

    // Final fallback: history scan in a bounded window
    const historyFallbackNeeded = found.size < suiteBots.length && !messages;
    if (historyFallbackNeeded) {
      const oldestTs = (new Date(phase2After + 'T00:00:00Z').getTime() / 1000).toString();
      const latestTs = ((startOfToday.getTime() - 1) / 1000).toString();
      // Fetch smaller page and scan newest-first
      const history = await this.slackClient.getChannelHistoryForDateRange(channel, oldestTs, latestTs, 200);
      history.sort((a, b) => parseFloat(b.ts || '0') - parseFloat(a.ts || '0'));
      for (const m of history) {
        if (!this.isRelevantTestBot(m)) continue;
        const type = this.determineTestTypeFromBot(m, (m.text || ''));
        if (type === 'Unknown Test' || found.has(type)) continue;
        found.set(type, m);
        if (found.size === suiteBots.length) break;
      }
    }

    // Build results from found messages (ensure consistent order by suite set)
    const expectedOrder = ['Cypress (general)', 'Cypress (unverified)', 'Playwright'] as const;
    const testResults: TestResult[] = [];
    for (const suite of expectedOrder) {
      const message = found.get(suite);
      if (!message) continue;

      const extractedText = extractAllMessageText(message);
      const testType = suite;
      const parsedResults = parseTestResultsFromText(extractedText.text);

      // Determine status
      let status = parsedResults.status || 'unknown';
      if (status === 'unknown') {
        const { status: fallbackStatus } = TextAnalyzer.analyzeTestResult(message);
        status = fallbackStatus;
      }
      if ((status === 'unknown' || status === 'pending') && testType === 'Playwright') {
        const raw = extractedText.text || '';
        const normalized = raw.replace(/\*/g, '').toLowerCase();
        const phraseMatch = /frontend\s+qa\s+playwright\s+tests\s+passed/.test(normalized);
        const jenkinsSuccess = /kahoot-frontend-player-qa-playwright|playwright/.test(normalized) && /success|passed/.test(normalized);
        if (phraseMatch || jenkinsSuccess) {
          status = 'passed';
        } else if (/(failed)/i.test(normalized)) {
          status = 'failed';
        } else {
          try {
            const full = await this.slackClient.getMessageDetails(channel, message.ts!);
            const fullText = extractAllMessageText(full).text || '';
            const fullNorm = fullText.replace(/\*/g, '').toLowerCase();
            if (/frontend\s+qa\s+playwright\s+tests\s+passed/.test(fullNorm) || (/playwright/.test(fullNorm) && /success|passed/.test(fullNorm))) {
              status = 'passed';
            } else if (/failed/.test(fullNorm)) {
              status = 'failed';
            } else {
              const reparsed = parseTestResultsFromText(fullText);
              if (reparsed.status === 'passed' || reparsed.status === 'failed') {
                status = reparsed.status as 'passed' | 'failed';
              }
            }
          } catch {}
        }
      }

      const normalizedStatus: 'passed' | 'failed' | 'pending' =
        status === 'passed' || status === 'failed' ? (status as 'passed' | 'failed') : 'pending';

      const threadAnalysis = await this.checkForReview(message, channel, normalizedStatus);
      const permalink = await this.slackClient.getPermalink(channel, message.ts!);

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
      // rerun success signals
      rerunSuccessful: /(re[- ]?run|re\s*run|re\s*-\s*run).*pass|passed on re\s*[- ]?run|fixed|resolved|all\s+tests\s+pass/i.test(allText),
      // investigation in progress
      underInvestigation: /investigat|will\s+look|looking\s+into|checking|check\s+it\s+out|on\s+it/i.test(allText),
      // explicit non-blocking statements
      notBlocking: /not\s+blocking|reviewed\s*[—-]?\s*not\s+blocking|green\s+light|not\s+(a\s+)?release\s+blocker/i.test(allText),
      // still failing after attempts
      stillFailing: /still\s+fail|re[- ]?run\s+fail|not\s+fixed|issue\s+persists|keeps\s+failing/i.test(allText),
      // revert intent or action
      revert: /\bwill\s+revert\b|\brevert(ed)?\b/i.test(allText),
      // PR signal (explicit words or GitHub PR URL)
      prOpened: /(https?:\/\/\S*github\.com\/\S*\/pull\/\d+)|\b(pr|pull\s*request)\b|opening\s*pr|opened\s*pr/i.test(allText)
    } as const;

    // Build summary
    let summary = '';
    
    if (failedTests.length > 0) {
      summary += `Failed tests: ${failedTests.slice(0, 3).join(', ')}${failedTests.length > 3 ? '...' : ''}. `;
    }
    
    if (outcomes.rerunSuccessful) {
      summary += 'Manual rerun successful ✅';
    }
    if (!outcomes.rerunSuccessful && outcomes.notBlocking) {
      summary += (summary ? ' • ' : '') + 'Reviewed - not blocking ✅';
    }
    if (!outcomes.rerunSuccessful && outcomes.stillFailing) {
      summary += (summary ? ' • ' : '') + 'Still failing after rerun ❌';
    }
    if (outcomes.revert) {
      summary += (summary ? ' • ' : '') + 'revert planned/applied';
    }
    if (outcomes.prOpened) {
      summary += (summary ? ' • ' : '') + 'PR opened';
    }
    if (!summary) {
      if (outcomes.underInvestigation) {
        summary = 'Under investigation 🔍';
      } else {
        summary = 'Thread activity - status unclear';
      }
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

      // Consider a failed suite resolved if the thread indicates either:
      // - explicitly not blocking, or
      // - rerun success AND (PR opened OR revert planned/applied)
      const isResolvedFailure = (t: TestResult): boolean => {
        if (t.status !== 'failed' || !t.hasReview) return false;
        const summary = (t.reviewSummary || '').toLowerCase();
        const notBlocking = summary.includes('not blocking');
        const rerunSuccess = summary.includes('manual rerun successful') || /rerun successful|resolved|fixed/.test(summary);
        const prOrRevert = summary.includes('pr opened') || summary.includes('revert');
        return notBlocking || (rerunSuccess && prOrRevert);
      };

      const allResolvedOrPassed = present.every(
        t => t.status === 'passed' || isResolvedFailure(t)
      );

      if (allPassed && present.length >= 2) {
        output += `✅ **AUTO TEST STATUS: ALL PASSED**\n`;
      } else if (allResolvedOrPassed && present.length >= 2) {
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