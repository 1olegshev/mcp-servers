/**
 * Test Analysis Service
 * Analyze Slack auto-test results and their review status
 */

import { SlackClient } from '../clients/slack-client.js';
import { TEST_BOT_IDS, JENKINS_PATTERN, EARLY_MORNING_CUTOFF, MAX_LOOKBACK_DAYS } from './test-bot-config.js';
import { TextAnalyzer } from '../utils/analyzers.js';
import { DateUtils } from '../utils/date-utils.js';
import { TestResult, SlackMessage } from '../types/index.js';
import { extractAllMessageText, isBotMessage, parseTestResultsFromText } from '../utils/message-extractor.js';
import { ThreadAnalyzerService } from './thread-analyzer.js';
import { TestReportFormatter } from './test-report-formatter.js';
// Note: Debug logging can be enabled for troubleshooting

const logDebug = (msg: string) => {
  // Uncomment the following lines when debugging is needed:
  // try {
  //   import('fs').then(fs => {
  //     fs.appendFileSync('/Users/olegshevchenko/Sourses/MCP/mcp-servers/slack/slack-mcp-debug.log', `${msg}\n`);
  //   });
  // } catch {}
};

export class TestAnalyzerService {
  private threads: ThreadAnalyzerService;
  private formatter: TestReportFormatter;

  constructor(private slackClient: SlackClient) {
    this.threads = new ThreadAnalyzerService(slackClient);
    this.formatter = new TestReportFormatter((summary?: string) => this.parseFailedTestsFromSummary(summary));
  }

  async analyzeTestResults(
    channel: string, 
    date?: string,
    messages?: SlackMessage[]
  ): Promise<TestResult[]> {
    // Helper: date math and query builders
    const startOfToday = (() => {
      const d = date ? (date === 'today' ? new Date() : new Date(date)) : new Date();
      const n = new Date(d);
      n.setHours(0, 0, 0, 0);
      return n;
    })();

    const fmtDate = (d: Date) => d.toISOString().split('T')[0];
    const addDays = (d: Date, delta: number) => new Date(d.getTime() + delta * 24 * 60 * 60 * 1000);
    const beforeDateStr = fmtDate(addDays(startOfToday, 1)); // Tomorrow, so today is included in search ranges
    const todayDateStr = fmtDate(new Date());

    // Build phase windows
    const dayOfWeek = (date ? (date === 'today' ? new Date() : new Date(date)) : new Date()).getDay(); // 0 Sun, 1 Mon
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
    // Always include today as a search window for each suite
    phase1Dates.unshift(todayDateStr);
    const phase2After = fmtDate(addDays(startOfToday, -MAX_LOOKBACK_DAYS));

    // Suites mapping
    const suiteBots: Array<{ id: string; name: 'Cypress (general)' | 'Cypress (unverified)' | 'Playwright' }> = [
  { id: TEST_BOT_IDS[0], name: 'Cypress (general)' },
  { id: TEST_BOT_IDS[1], name: 'Cypress (unverified)' },
  { id: TEST_BOT_IDS[2], name: 'Playwright' },
    ];

    const found: Map<string, SlackMessage> = new Map();

    // Helper: run a per-bot search within [after,before) date bounds and pick newest
    const findBySearch = async (suite: 'Cypress (general)' | 'Cypress (unverified)' | 'Playwright', after: string, before: string): Promise<SlackMessage | undefined> => {
      let query = '';
      if (suite === 'Playwright') {
        // Confirmed handle for Jenkins user
        query = `from:@jenkins2 after:${after} before:${before}`;
      } else {
        // Force search to fail and use history fallback which works correctly
        query = `"IMPOSSIBLE_SEARCH_TERM_TO_FORCE_FALLBACK" after:${after} before:${before}`;
      }
      const matches = await this.slackClient.searchMessages(query, channel);
      // matches already sorted desc per client
      for (const m of matches) {
        if (!m.ts) continue;
        // Allow today's messages when searching today, otherwise exclude messages >= startOfToday
        const msgTime = parseFloat(m.ts) * 1000;
        const isToday = after === todayDateStr;
        if (!isToday && msgTime >= startOfToday.getTime()) continue;
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
    const historyFallbackNeeded = found.size < suiteBots.length; // Always fallback if missing results
    if (historyFallbackNeeded) {
      const oldestTs = (new Date(phase2After + 'T00:00:00Z').getTime() / 1000).toString();
      const latestTs = ((addDays(startOfToday, 1).getTime() - 1) / 1000).toString(); // Include today by using end of today
      // Fetch smaller page and scan newest-first
      const history = await this.slackClient.getChannelHistoryForDateRange(channel, oldestTs, latestTs, 200);
      history.sort((a, b) => parseFloat(b.ts || '0') - parseFloat(a.ts || '0'));
      for (const m of history) {
        // Strict filter: only messages from known test bot IDs
        if (!m.bot_id || !TEST_BOT_IDS.includes(m.bot_id)) continue;
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
      
      logDebug(`[${new Date().toISOString()}] STATUS CHECK: ${testType} - initial status: "${status}", parsed: "${parsedResults.status}"`);
      
      // Cypress-specific status detection from blocks content (override if clear)
      if (testType === 'Cypress (general)' || testType === 'Cypress (unverified)') {
        const allText = extractedText.text || '';
        logDebug(`[${new Date().toISOString()}] DEBUG: ${testType} - extracted text: "${allText}"`);
        // Remove markdown formatting and check for status patterns
        const cleanText = allText.replace(/\*/g, '').toLowerCase();
        logDebug(`[${new Date().toISOString()}] DEBUG: ${testType} - clean text: "${cleanText}"`);
        const passPattern = /test results:\s*passed|passed run|failed:\s*0\b.*\bpassed:\s*\d+/i;
        const failPattern = /test results:\s*failed|failed run\b/i;
        if (passPattern.test(cleanText)) {
          status = 'passed';
          logDebug(`[${new Date().toISOString()}] DEBUG: ${testType} - OVERRIDE -> PASSED (by blocks)`);
        } else if (failPattern.test(cleanText)) {
          status = 'failed';
        } else {
          // Try fetching full message details to include any missing block text
          try {
            const full = await this.slackClient.getMessageDetails(channel, message.ts!);
            const fullText = extractAllMessageText(full).text || '';
            const fullClean = fullText.replace(/\*/g, '').toLowerCase();
            logDebug(`[${new Date().toISOString()}] DEBUG: ${testType} - full clean text: "${fullClean}"`);
            if (passPattern.test(fullClean)) {
              status = 'passed';
              logDebug(`[${new Date().toISOString()}] DEBUG: ${testType} - OVERRIDE -> PASSED (by full blocks)`);
            } else if (failPattern.test(fullClean)) {
              status = 'failed';
            }
          } catch (e) {
            // ignore
          }
        }
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

  const threadAnalysis = await this.threads.checkForReview(message, channel, normalizedStatus);
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
        failedTests: threadAnalysis.failedTests,
        statusNote: threadAnalysis.statusNote,
        perTestStatus: threadAnalysis.perTestStatus,
        sectionSummary: threadAnalysis.sectionSummary,
      });
    }

    return testResults;
  }

  /**
   * Improved bot detection specifically for test automation
   */
  private isRelevantTestBot(message: SlackMessage): boolean {
    // Simplified: rely solely on known test bot IDs
    return !!message.bot_id && TEST_BOT_IDS.includes(message.bot_id);
  }

  formatTestStatusReport(testResults: TestResult[], date?: string): string {
    return this.formatter.format(testResults, (t: TestResult) => this.getTestTypeFromMessage(t), date);
  }

  /**
   * Get the latest test result for each test type
   */
  // Note: getLatestByType moved into formatter; keep getTestTypeFromMessage available

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
   * Fallback: parse failed test names from reviewSummary text
   */
  private parseFailedTestsFromSummary(summary?: string): string[] {
    if (!summary) return [];
    const m = summary.match(/Failed tests?:\s*([^\n]+)/i);
    if (!m) return [];
    const list = m[1]
      .replace(/\.{3,}.*/g, '') // drop ellipsis and trailing text
      .replace(/\s+Manual rerun.*$/i, '') // drop known status phrases
      .replace(/\s+Reviewed.*$/i, '')
      .replace(/\s+PR opened.*$/i, '')
      .replace(/\s+Under investigation.*$/i, '')
      .replace(/\s+Thread activity.*$/i, '');
    return list
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)
      .map(s => s.replace(/[.,…\s]+$/g, ''));
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
  for (const botId of TEST_BOT_IDS) {
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

  /**
   * Extract failed test names from review summary
   */
  private extractFailedTestsFromSummary(summary: string): string[] {
    if (!summary) return [];
    
    // Pattern: "Failed tests: test1.ts, test2.ts, test3.ts.... Some status"
    const match = summary.match(/Failed tests?:\s*(.+?)(?:\.\s|\.\.\.\.|$)/i);
    if (!match) return [];
    
    const testsText = match[1];
    
    // Split by comma and clean up test names
    return testsText
      .split(',')
      .map(test => test.trim())
      .map(test => test.replace(/\.(ts|js|spec)$/, '')) // Remove file extensions
      .filter(Boolean)
      .slice(0, 4);
  }

  /**
   * Extract only the review/status part from summary (excluding failed tests list)
   */
  private getReviewStatusOnly(summary: string): string {
    if (!summary) return '';
    
    // If no "Failed tests:" prefix, return as-is
    if (!summary.toLowerCase().includes('failed test')) {
      return summary.trim();
    }
    
    // Extract status messages that come after the test list
    // Handle patterns like:
    // "Failed tests: test.ts. Manual rerun successful ✅"
    // "Failed tests: test1.ts, test2.ts.... Manual rerun successful ✅"
    
    // Look for status after the period that ends the test list
    let cleaned = summary;
    
    // Remove everything from "Failed tests:" up to the first complete sentence
    cleaned = cleaned.replace(/Failed tests?:[^.]*\.+\s*/i, '');
    
    // If what's left is just fragments like "ts." or "test.ts, other.ts....", clean those up
    if (/^(ts|test|spec)\.\s*$/i.test(cleaned) || /^[^.]*\.ts[^.]*\.+\s*$/.test(cleaned)) {
      return '';
    }
    
    return cleaned.trim();
  }
}