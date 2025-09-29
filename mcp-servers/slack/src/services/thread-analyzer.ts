import { SlackClient } from '../clients/slack-client.js';
import { SlackMessage } from '../types/index.js';
import { extractAllMessageText } from '../utils/message-extractor.js';

export class ThreadAnalyzerService {
  constructor(private slackClient: SlackClient) {}

  async checkForReview(
    message: SlackMessage,
    channel: string,
    status: string
  ): Promise<{ hasReview: boolean; summary: string; failedTests?: string[]; statusNote?: string; perTestStatus?: Record<string, string>; sectionSummary?: string }> {
    if (status !== 'failed' || !(message.thread_ts || (message.reply_count || 0) > 0)) {
      return { hasReview: false, summary: '' };
    }

    try {
      const replies = await this.slackClient.getThreadReplies(channel, message.ts!);
      const analysis = this.analyzeThreadContent(replies, message);
      return {
        hasReview: analysis.hasActivity,
        summary: analysis.summary,
        failedTests: analysis.failedTests,
        statusNote: analysis.statusNote,
        perTestStatus: analysis.perTestStatus,
        sectionSummary: analysis.sectionSummary,
      };
    } catch (error) {
      console.error('Failed to check test review:', error);
    }

    return { hasReview: false, summary: '', failedTests: [], statusNote: '', perTestStatus: {}, sectionSummary: '⏳ Awaiting review' };
  }

  private analyzeThreadContent(
    replies: SlackMessage[],
    originalMessage: SlackMessage
  ): { hasActivity: boolean; summary: string; failedTests: string[]; statusNote: string; perTestStatus: Record<string, string>; sectionSummary: string } {
    if (replies.length === 0) {
      return { hasActivity: false, summary: '', failedTests: [], statusNote: '', perTestStatus: {}, sectionSummary: '⏳ Awaiting review' };
    }

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

    const failedTests = this.extractFailedTestNames(allText);
    const normalizeTest = (t: string) => t
      .replace(/\.(test|spec)\.[jt]sx?/i, '')
      .replace(/\.[jt]sx?/i, '')
      .replace(/^.*[\/]/, '')
      .trim();
    const normalizedFailed = Array.from(new Set(failedTests.map(normalizeTest)));

    const perTestStatus: Record<string, string> = {};
    const perTestPriority: Record<string, number> = {};

    // Process messages chronologically - most recent status wins
    const allMessages = [originalMessage, ...replies];
    for (const message of allMessages) {
      const messageText = collectText(message);
      
      for (const t of normalizedFailed) {
        const testPattern = new RegExp(`${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\.ts)?`, 'i');
        
        if (testPattern.test(messageText)) {
          const context = messageText.toLowerCase();
          const isHuman = !!message.user && !(message as any).bot_id;
          let bestStatus = '';
          let bestPriority = -1;
          
          // Define status patterns with priorities (check most specific first)
          const statusPatterns = [
            { pattern: /manual\s+re[-\s]?run\s+successful|passed\s+on\s+re[-\s]?run|re[-\s]?run\s+passed/, status: '✅ resolved' },
            { pattern: /(passed|passing|fixed|resolved|green)/, status: '✅ resolved' },
            { pattern: /\bnot\s+blocking\b/, status: '✅ not blocking' },
            // Active progression states
            { pattern: /(on\s+me|my\s+responsibility|i'll\s+take|assigned\s+to\s+me)/, status: '🔄 assigned' },
            { pattern: /(?:started|starting|kicked(?:\s+off)?|triggered|triggering)\s+(?:a\s+)?re[-\s]?run|re[-\s]?running\s+(?:now|again|today)|rerun\s+in\s+progress/, status: '🔄 rerun in progress' },
            { pattern: /(fix.*review|should\s+be\s+fixed)/, status: '🔄 fix in progress' },
            // Context/acknowledgement states
            { pattern: /(known\s+issue|already\s+aware|acknowledged)/, status: 'ℹ️ acknowledged' },
            { pattern: /(cannot\s+repro(duce)?|can[’'`]t\s+repro(duce)?|cant\s+repro(duce)?)/, status: 'ℹ️ needs repro' },
            { pattern: /(passes|works)\s+(for\s+me\s+)?locally|\bflak(?:e|y)\b/, status: '⚠️ flakey/env-specific' },
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

    for (const testName of normalizedFailed) {
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
      failedTests: normalizedFailed,
      statusNote: statusNote.trim(),
      perTestStatus,
      sectionSummary,
    };
  }

  private extractFailedTestNames(text: string): string[] {
    let processed = text;
    try { processed = decodeURIComponent(text); } catch {}
    processed = processed.replace(/%2F/gi, '/');
    const fileRegex = /([\w\-\/]+(?:_spec|\.spec|\.test|_test)?\.[jt]sx?)/gi;
    const matches = processed.match(fileRegex) || [];
    const normalized = matches
      .map(m => {
      const cleaned = m.replace(/^\/*/, '');
      const base = cleaned.replace(/^.*[\\\/]/, '');
      return base.replace(/^2f+/i, '');
      })
      .map(name => {
        // Heuristic: treat names that lack spec/test suffix in the thread as E2E specs
        if (!/(?:_spec|\.spec|\.test|_test)\.[jt]sx?$/i.test(name)) {
          return name.replace(/\.[tj]sx?$/i, '_spec$&');
        }
        return name;
      });
    return Array.from(new Set(normalized));
  }

  private calculateSectionStatus(perTestStatus: Record<string, string>): string {
    const statuses = Object.values(perTestStatus);
    
    if (statuses.length === 0) {
      return '⏳ Awaiting review';
    }
    
    const counts = this.classifyStatuses(perTestStatus);
    const {
      resolvedCount,
      assignedCount,
      rerunCount,
      fixProgressCount,
      ackCount,
      rootCauseCount,
      explainedCount,
      needsReproCount,
      flakeyCount,
      testUpdateCount,
      unclearCount,
      investigatingCount,
      blockerCount,
    } = counts;
    
    if (blockerCount > 0) {
      return `🚫 ${blockerCount} blocker${blockerCount > 1 ? 's' : ''} found`;
    }
    
    const parts: string[] = [];
    
    if (resolvedCount > 0) {
      parts.push(`✅ ${resolvedCount} resolved/not blocking`);
    }

    const progressParts: string[] = [];
    if (assignedCount > 0) progressParts.push(`assigned ${assignedCount}`);
    if (rerunCount > 0) progressParts.push(`rerun ${rerunCount}`);
    if (fixProgressCount > 0) progressParts.push(`fix ${fixProgressCount}`);
    if (needsReproCount > 0) progressParts.push(`needs repro ${needsReproCount}`);
    if (progressParts.length > 0) {
      parts.push(`🔄 ${progressParts.join(', ')}`);
    }

    if (investigatingCount > 0) {
      parts.push(`🔍 ${investigatingCount} under investigation`);
    }

    if (unclearCount > 0) {
      parts.push(`❓ ${unclearCount} needs review`);
    }

    const infoParts: string[] = [];
    if (ackCount > 0) infoParts.push(`ack ${ackCount}`);
    if (rootCauseCount > 0) infoParts.push(`root cause ${rootCauseCount}`);
    if (explainedCount > 0) infoParts.push(`explained ${explainedCount}`);
    if (flakeyCount > 0) infoParts.push(`flakey ${flakeyCount}`);
    if (testUpdateCount > 0) infoParts.push(`test update ${testUpdateCount}`);
    if (infoParts.length > 0) {
      parts.push(`ℹ️ ${infoParts.join(', ')}`);
    }

    if (parts.length > 0) {
      return parts.join(' • ');
    }

    return '❓ Status unclear - review needed';
  }

  classifyStatuses(perTestStatus: Record<string, string>) {
    const statuses = Object.values(perTestStatus);

    const counts = {
      resolvedCount: 0,
      assignedCount: 0,
      rerunCount: 0,
      fixProgressCount: 0,
      ackCount: 0,
      rootCauseCount: 0,
      explainedCount: 0,
      needsReproCount: 0,
      flakeyCount: 0,
      testUpdateCount: 0,
      unclearCount: 0,
      investigatingCount: 0,
      blockerCount: 0,
    };

    for (const status of statuses) {
      const l = status.toLowerCase();
      if (l.includes('blocker') && !l.includes('not blocking')) {
        counts.blockerCount++;
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
      '🔄 fix in progress': 60,
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
