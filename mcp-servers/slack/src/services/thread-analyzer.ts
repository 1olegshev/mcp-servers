import { SlackClient } from '../clients/slack-client.js';
import { SlackMessage } from '../types/index.js';
import { extractAllMessageText } from '../utils/message-extractor.js';
import { LLMTestClassifierService, TestStatusClassification } from './llm-test-classifier.service.js';

export class ThreadAnalyzerService {
  private llmClassifier: LLMTestClassifierService | null = null;
  private llmInitialized: boolean = false;
  private useLLMClassification: boolean = true;

  constructor(private slackClient: SlackClient) {}

  /**
   * Enable/disable LLM classification
   */
  setLLMClassification(enabled: boolean): void {
    this.useLLMClassification = enabled;
  }

  /**
   * Lazily initialize the LLM classifier
   */
  private async ensureLLMInitialized(): Promise<void> {
    if (this.llmInitialized) return;
    this.llmInitialized = true;

    try {
      this.llmClassifier = new LLMTestClassifierService();
      const available = await this.llmClassifier.isAvailable();
      if (available) {
        console.error('LLM test classifier initialized (Ollama available)');
      } else {
        console.error('LLM test classifier disabled (Ollama not available)');
        this.useLLMClassification = false;
      }
    } catch (error) {
      console.error('Failed to initialize LLM test classifier:', error);
      this.useLLMClassification = false;
    }
  }

  async checkForReview(
    message: SlackMessage,
    channel: string,
    status: string
  ): Promise<{ hasReview: boolean; summary: string; failedTests?: string[]; statusNote?: string; perTestStatus?: Record<string, string>; perTestConfidence?: Record<string, number>; sectionSummary?: string }> {
    // Skip non-failed tests
    if (status !== 'failed') {
      return { hasReview: false, summary: '' };
    }
    // Always analyze failed tests - even if no replies yet, we want to show the failed test names

    try {
      const replies = await this.slackClient.getThreadReplies(channel, message.ts!);

      // First, do regex-based analysis to extract failed tests
      const regexAnalysis = this.analyzeThreadContent(replies, message);

      // Try LLM classification if enabled, we have failed tests, AND there are replies to analyze
      // Skip LLM if no replies - nothing for it to classify, keep "awaiting review" status
      if (this.useLLMClassification && regexAnalysis.failedTests.length > 0 && replies.length > 0) {
        await this.ensureLLMInitialized();

        if (this.llmClassifier && this.useLLMClassification) {
          try {
            const llmResult = await this.llmClassifier.classifyThread(
              message,
              replies,
              regexAnalysis.failedTests
            );

            if (llmResult.usedLLM && Object.keys(llmResult.perTestStatus).length > 0) {
              // LLM succeeded - merge results, preferring LLM for high-confidence classifications
              const { merged: mergedPerTestStatus, confidence: perTestConfidence } = this.mergeClassifications(
                regexAnalysis.perTestStatus,
                llmResult.perTestStatus
              );

              // Post-process: check last few messages for clear resolution signal
              // This overrides LLM "needs_attention" when thread ends with "it did pass" etc.
              if (replies.length > 0) {
                const resolutionPattern = /\b(it\s+did\s+pass|now\s+it\s+pass|passes\s+now|works\s+now|it\s+pass(?:es)?|did\s+pass)\b/i;
                // Check last 3 messages for resolution signal (in case final message is follow-up discussion)
                const lastMessages = replies.slice(-3);
                const hasResolution = lastMessages.some(msg =>
                  resolutionPattern.test(extractAllMessageText(msg).text)
                );
                if (hasResolution) {
                  for (const testName of Object.keys(mergedPerTestStatus)) {
                    if (mergedPerTestStatus[testName].toLowerCase().includes('needs attention')) {
                      mergedPerTestStatus[testName] = '✅ resolved';
                      console.error(`Post-process override: ${testName} → resolved (recent message has resolution signal)`);
                    }
                  }
                }
              }

              const sectionSummary = this.calculateSectionStatus(mergedPerTestStatus);

              console.error(`LLM test classification complete: ${llmResult.overallSummary}`);

              return {
                hasReview: regexAnalysis.hasActivity,
                summary: regexAnalysis.summary,
                failedTests: regexAnalysis.failedTests,
                statusNote: regexAnalysis.statusNote,
                perTestStatus: mergedPerTestStatus,
                perTestConfidence,
                sectionSummary,
              };
            }
          } catch (llmError) {
            console.error('LLM test classification failed, using regex results:', llmError);
          }
        }
      }

      // Fall back to regex-only results
      return {
        hasReview: regexAnalysis.hasActivity,
        summary: regexAnalysis.summary,
        failedTests: regexAnalysis.failedTests,
        statusNote: regexAnalysis.statusNote,
        perTestStatus: regexAnalysis.perTestStatus,
        sectionSummary: regexAnalysis.sectionSummary,
      };
    } catch (error) {
      console.error('Failed to check test review:', error);
    }

    return { hasReview: false, summary: '', failedTests: [], statusNote: '', perTestStatus: {}, sectionSummary: '⏳ Awaiting review' };
  }

  /**
   * Merge regex and LLM classifications
   * LLM takes precedence for explicit signals that regex might miss
   */
  private mergeClassifications(
    regexStatus: Record<string, string>,
    llmStatus: Record<string, TestStatusClassification>
  ): { merged: Record<string, string>; confidence: Record<string, number> } {
    const merged: Record<string, string> = { ...regexStatus };
    const confidence: Record<string, number> = {};

    // Positive statuses that indicate explicit human decisions - trust LLM for these
    const explicitPositiveStatuses = ['resolved', 'not blocking', 'fix in progress', 'tracked', 'flakey'];

    for (const [testName, llmResult] of Object.entries(llmStatus)) {
      const regexResult = regexStatus[testName];
      const llmStatusLower = llmResult.status.toLowerCase();

      // LLM takes precedence if:
      // 1. Regex result is unclear ("❓ needs review")
      // 2. LLM has high confidence (>= 70%)
      // 3. Regex didn't find this test
      // 4. LLM detected an explicit positive signal (resolved, not blocking, etc.) with moderate confidence
      const regexIsUnclear = !regexResult || regexResult.includes('needs review') || regexResult.includes('unclear');
      const llmIsConfident = llmResult.confidence >= 70;
      const llmFoundExplicitPositive = explicitPositiveStatuses.some(s => llmStatusLower.includes(s)) && llmResult.confidence >= 50;

      if (regexIsUnclear || llmIsConfident || llmFoundExplicitPositive) {
        merged[testName] = llmResult.status;
        confidence[testName] = llmResult.confidence;
      }
    }

    return { merged, confidence };
  }

  private analyzeThreadContent(
    replies: SlackMessage[],
    originalMessage: SlackMessage
  ): { hasActivity: boolean; summary: string; failedTests: string[]; statusNote: string; perTestStatus: Record<string, string>; sectionSummary: string } {
    const collectText = (m: SlackMessage) => extractAllMessageText(m).text;

    // Extract failed tests from original message even if no replies yet
    const originalText = collectText(originalMessage);
    const failedTests = this.extractFailedTestNames(originalText);
    const normalizeTest = (t: string) => t
      .replace(/\.(test|spec)\.[jt]sx?/i, '')
      .replace(/\.[jt]sx?/i, '')
      .replace(/^.*[\/]/, '')
      .trim();
    const normalizedFailed = Array.from(new Set(failedTests.map(normalizeTest)));

    // If no replies, mark all tests as awaiting review
    if (replies.length === 0) {
      const perTestStatus: Record<string, string> = {};
      for (const test of normalizedFailed) {
        perTestStatus[test] = '⏳ awaiting review';
      }
      return {
        hasActivity: false,
        summary: '',
        failedTests: normalizedFailed,
        statusNote: '',
        perTestStatus,
        sectionSummary: `⏳ ${normalizedFailed.length} tests awaiting review`
      };
    }

    // Also extract from replies to catch any additional test mentions
    const threadTexts = [originalText, ...replies.map(collectText)];
    const allText = threadTexts.join(' ').toLowerCase();
    const allFailedTests = this.extractFailedTestNames(allText);
    const allNormalized = Array.from(new Set(allFailedTests.map(normalizeTest)));

    // Use combined list if replies mention additional tests
    const finalFailed = allNormalized.length > normalizedFailed.length ? allNormalized : normalizedFailed;

    const perTestStatus: Record<string, string> = {};
    const perTestPriority: Record<string, number> = {};

    // Process messages chronologically - most recent status wins
    const allMessages = [originalMessage, ...replies];
    for (const message of allMessages) {
      const messageText = collectText(message);

      // Check if message mentions any specific test
      const mentionedTests: string[] = [];
      for (const t of finalFailed) {
        const testPattern = new RegExp(`${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\.ts)?`, 'i');
        if (testPattern.test(messageText)) {
          mentionedTests.push(t);
        }
      }

      // If no specific test mentioned but message has status info, apply to ALL tests (generic follow-up)
      const hasStatusKeyword = /(pass|fail|flak|fix|resolved|blocked|investigat|locally)/i.test(messageText);
      const testsToAnalyze = mentionedTests.length > 0 ? mentionedTests : (hasStatusKeyword ? finalFailed : []);

      for (const t of testsToAnalyze) {
        const testMentioned = mentionedTests.includes(t);

        if (testMentioned || (mentionedTests.length === 0 && hasStatusKeyword)) {
          const context = messageText.toLowerCase();
          const isHuman = !!message.user && !(message as any).bot_id;
          let bestStatus = '';
          let bestPriority = -1;
          
          // Define status patterns with priorities (check most specific first)
          const statusPatterns = [
            { pattern: /manual\s+re[-\s]?run\s+successful|passed\s+on\s+re[-\s]?run|re[-\s]?run\s+passed/, status: '✅ resolved' },
            { pattern: /(pass(?:ed|es|ing)?|did\s+pass|fixed|resolved|green)/, status: '✅ resolved' },
            { pattern: /\bnot\s+blocking\b/, status: '✅ not blocking' },
            // Active progression states
            { pattern: /(on\s+me|my\s+responsibility|i'll\s+take|assigned\s+to\s+me)/, status: '🔄 assigned' },
            { pattern: /(?:started|starting|kicked(?:\s+off)?|triggered|triggering)\s+(?:a\s+)?re[-\s]?run|re[-\s]?running\s+(?:now|again|today)|rerun\s+in\s+progress/, status: '🔄 rerun in progress' },
            { pattern: /(fix.*review|should\s+be\s+fixed)/, status: '🔄 fix in progress' },
            // Context/acknowledgement states
            { pattern: /(known\s+issue|already\s+aware|acknowledged)/, status: 'ℹ️ acknowledged' },
            { pattern: /(cannot\s+repro(duce)?|can[’'`]t\s+repro(duce)?|cant\s+repro(duce)?)/, status: 'ℹ️ needs repro' },
            { pattern: /(pass(?:es|ed|ing)?|works)\s+(for\s+me\s+)?locally|\bflak(?:e|y)\b/, status: '⚠️ flakey/env-specific' },
            { pattern: /(test.*updat|button.*moved|selector.*chang|selector.*moved)/, status: '🛠️ test update required' },
            { pattern: /(root\s+cause|specific.*fix|technical.*reason)/, status: '🔍 root cause identified' },
            { pattern: /(explained|setup\s+issue|test\s+issue|just.*issue)/, status: 'ℹ️ explained' },
            // Investigation / failure
            { pattern: /revert/, status: '♻️ revert planned/applied' },
            { pattern: /(investigat|working on|looking into|i'll look|as we speak)/, status: '🔍 investigating' },
            { pattern: /still\s+failing/, status: '❌ still failing' }
          ];
          
          // Find best matching pattern by priority
          for (const { pattern, status } of statusPatterns) {
            if (pattern.test(context)) {
              let priority = this.getStatusPriority(status);
              if (!isHuman) {
                priority = Math.min(priority, 30);
              }
              if (priority > bestPriority) {
                bestPriority = priority;
                bestStatus = status;
              }
            }
          }
          
          if (bestStatus) {
            const currentPriority = perTestPriority[t] ?? -1;
            if (bestPriority >= currentPriority) {
              perTestStatus[t] = bestStatus;
              perTestPriority[t] = bestPriority;
            }
          }
        }
      }
    }

    for (const testName of finalFailed) {
      if (!perTestStatus[testName]) {
        perTestStatus[testName] = '❓ needs review';
        perTestPriority[testName] = this.getStatusPriority('❓ needs review');
      }
    }

    const outcomes = {
      rerunSuccessful: /(re[- ]?run|re\s*run|re\s*-\s*run).*pass|passed on re\s*[- ]?run|fixed|resolved|all\s+tests\s+pass/i.test(allText),
      underInvestigation: /investigat|will\s+look|looking\s+into|checking|check\s+it\s+out|on\s+it/i.test(allText),
      notBlocking: /not\s+blocking|reviewed\s*[—-]?\s*not\s+blocking|green\s+light|not\s+(a\s+)?release\s+blocker/i.test(allText),
      stillFailing: /still\s+fail|re[- ]?run\s+fail|not\s+fixed|issue\s+persists|keeps\s+failing/i.test(allText),
      revert: /\bwill\s+revert\b|\brevert(ed)?\b/i.test(allText),
      prOpened: /(https?:\/\/\S*github\.com\/\S*\/pull\/\d+)|\b(pr|pull\s*request)\b|opening\s*pr|opened\s*pr/i.test(allText)
    } as const;

    let summary = '';
    let statusNote = '';
    if (failedTests.length > 0) {
      summary += `Failed tests: ${failedTests.join(', ')}.`;
    }

    if (outcomes.rerunSuccessful) {
      summary += 'Manual rerun successful ✅';
      statusNote = 'Manual rerun successful ✅';
    }
    if (!outcomes.rerunSuccessful && outcomes.notBlocking) {
      summary += (summary ? ' • ' : '') + 'Reviewed - not blocking ✅';
      statusNote = 'Reviewed - not blocking ✅';
    }
    if (!outcomes.rerunSuccessful && outcomes.stillFailing) {
      summary += (summary ? ' • ' : '') + 'Still failing after rerun ❌';
      statusNote = 'Still failing after rerun ❌';
    }
    if (outcomes.revert) {
      summary += (summary ? ' • ' : '') + 'revert planned/applied';
      statusNote = statusNote ? `${statusNote} • revert planned/applied` : 'revert planned/applied';
    }
    if (outcomes.prOpened) {
      summary += (summary ? ' • ' : '') + 'PR opened';
      statusNote = statusNote ? `${statusNote} • PR opened` : 'PR opened';
    }
    if (!summary) {
      if (outcomes.underInvestigation) {
        summary = 'Under investigation 🔍';
        statusNote = 'Under investigation 🔍';
      } else {
        summary = 'Thread activity - status unclear';
        statusNote = 'Thread activity - status unclear';
      }
    }

    // Calculate section-level status based on individual test statuses
    const sectionSummary = this.calculateSectionStatus(perTestStatus);

    return {
      hasActivity: true,
      summary: summary.trim(),
      failedTests: finalFailed,
      statusNote: statusNote.trim(),
      perTestStatus,
      sectionSummary,
    };
  }

  private extractFailedTestNames(text: string): string[] {
    let processed = text;
    try { processed = decodeURIComponent(text); } catch {}
    processed = processed.replace(/%2F/gi, '/');

    // Pattern 1: Test files explicitly marked with .test. or _spec (high confidence)
    const testFileRegex = /([\w\-]+(?:\.test|_spec|\.spec|_test)\.[jt]sx?)/gi;
    const testFileMatches = processed.match(testFileRegex) || [];

    // Pattern 2: "Specs for Review:" section - lines with "path/file.ts  N failed test"
    const specsForReviewMatches: string[] = [];
    const specsForReviewRegex = /([\w\-\/]+(?:_spec)?\.tsx?)\s+\d+\s+failed/gi;
    let match;
    while ((match = specsForReviewRegex.exec(processed)) !== null) {
      if (match[1]) {
        specsForReviewMatches.push(match[1]);
      }
    }

    // Pattern 3: Backtick-quoted test names (explicit mentions like `test-name.ts`)
    const backtickMatches: string[] = [];
    const backtickRegex = /`([\w\-]+(?:\.test|_spec|\.spec|_test)?\.tsx?)`/gi;
    while ((match = backtickRegex.exec(processed)) !== null) {
      if (match[1]) {
        backtickMatches.push(match[1]);
      }
    }

    const allMatches = [...testFileMatches, ...specsForReviewMatches, ...backtickMatches];

    // Blocklist: page objects, helpers, utilities (not actual tests)
    const blocklist = /^(index|config|setup|utils?|helpers?|types?|constants?|models?|services?|playwright|cypress|jest|mocha|failed|passed|test|tests|spec|specs|pages?|components?|report|reports)$/i;

    // Additional blocklist for files that are clearly not tests (page objects, utilities)
    const pathBlocklist = /\/(pages|components|helpers|utils|fixtures|support)\//i;

    const normalized = allMatches
      .filter(m => !pathBlocklist.test(m)) // Filter out page objects etc from paths
      .map(m => {
        const cleaned = m.replace(/^\/*/, '');
        const base = cleaned.replace(/^.*[\\\/]/, '');
        return base.replace(/^2f+/i, '');
      })
      .map(name => {
        // Remove extension and normalize test suffix
        let normalized = name.replace(/\.[tj]sx?$/i, '');
        // Normalize: remove .test/.spec suffix for deduplication
        normalized = normalized.replace(/\.test$|\.spec$|_test$|_spec$/i, '');
        return normalized;
      })
      .filter(name => {
        // Filter out short names and blocklisted terms
        if (name.length < 5) return false;
        if (blocklist.test(name)) return false;
        // Filter out names that look like page objects (ending with Page, Component, etc)
        if (/Page$|Component$|Helper$|Util$|Service$/i.test(name)) return false;
        return true;
      });

    return Array.from(new Set(normalized));
  }

  private calculateSectionStatus(perTestStatus: Record<string, string>): string {
    const statuses = Object.values(perTestStatus);

    if (statuses.length === 0) {
      return '⏳ Awaiting review';
    }

    // Simple verdict logic: any test needing attention = suite needs attention
    for (const status of statuses) {
      const l = status.toLowerCase();

      // These statuses mean the suite needs attention
      if (l.includes('blocker') && !l.includes('not blocking')) {
        return '🚫 Blocker found';
      }
      if (l.includes('still failing')) {
        return '⚠️ Needs attention';
      }
      if (l.includes('needs attention') || l.includes('🚨')) {
        return '⚠️ Needs attention';
      }
      if (l.includes('unclear') || l.includes('needs review') || l.includes('❓')) {
        return '⚠️ Needs attention';
      }
    }

    // Check if any tests are in progress (not blocking, but not fully resolved either)
    let hasInProgress = false;
    for (const status of statuses) {
      const l = status.toLowerCase();
      if (l.includes('fix in progress') || l.includes('investigating') || l.includes('tracked')) {
        hasInProgress = true;
        break;
      }
    }

    if (hasInProgress) {
      return '🔄 In progress - not blocking';
    }

    // If we get here, all tests are in a "not blocking" state
    return '✅ Reviewed - not blocking';
  }

  classifyStatuses(perTestStatus: Record<string, string>) {
    const statuses = Object.values(perTestStatus);

    const counts = {
      resolvedCount: 0,
      assignedCount: 0,
      rerunCount: 0,
      fixProgressCount: 0,
      trackedCount: 0,
      ackCount: 0,
      rootCauseCount: 0,
      explainedCount: 0,
      needsReproCount: 0,
      flakeyCount: 0,
      testUpdateCount: 0,
      unclearCount: 0,
      investigatingCount: 0,
      blockerCount: 0,
      stillFailingCount: 0,
      revertCount: 0,
    };

    for (const status of statuses) {
      const l = status.toLowerCase();
      if (l.includes('blocker') && !l.includes('not blocking')) {
        counts.blockerCount++;
        continue;
      }
      if (l.includes('still failing')) {
        counts.stillFailingCount++;
        continue;
      }
      if (l.includes('revert')) {
        counts.revertCount++;
        continue;
      }
      if (l.includes('investigating') || l.includes('🔍')) {
        counts.investigatingCount++;
        continue;
      }
      if (l.includes('unclear') || l.includes('needs review')) {
        counts.unclearCount++;
        continue;
      }
      if (l.includes('resolved') || l.includes('not blocking')) {
        counts.resolvedCount++;
        continue;
      }
      if (l.includes('assigned')) counts.assignedCount++;
      if (l.includes('rerun in progress')) counts.rerunCount++;
      if (l.includes('fix in progress')) counts.fixProgressCount++;
      if (l.includes('tracked')) counts.trackedCount++;
      if (l.includes('acknowledged')) counts.ackCount++;
      if (l.includes('root cause identified')) counts.rootCauseCount++;
      if (l.includes('explained')) counts.explainedCount++;
      if (l.includes('needs repro')) counts.needsReproCount++;
      if (l.includes('flakey') || l.includes('flaky') || l.includes('env-specific')) counts.flakeyCount++;
      if (l.includes('test update required')) counts.testUpdateCount++;
    }

    return counts;
  }

  private getStatusPriority(status: string): number {
    const priorities: Record<string, number> = {
      '❌ still failing': 90,
      '🚫 blocker': 90,
      '♻️ revert planned/applied': 80,
      '🔄 rerun in progress': 70,
      '🔄 fix in progress': 65,
      '📋 tracked (known issue)': 60,
      '🔄 assigned': 55,
      '🔍 investigating': 50,
      '⚠️ flakey/env-specific': 45,
      '🛠️ test update required': 45,
      'ℹ️ needs repro': 40,
      '🔍 root cause identified': 40,
      'ℹ️ acknowledged': 35,
      'ℹ️ explained': 35,
      '✅ resolved': 85,
      '✅ not blocking': 80,
      '❓ needs review': 30,
    };
    return priorities[status] ?? 20;
  }
}
