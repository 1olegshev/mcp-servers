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
    
    // Process messages chronologically - most recent status wins
    const allMessages = [originalMessage, ...replies];
    for (const message of allMessages) {
      const messageText = collectText(message);
      
      for (const t of normalizedFailed) {
        const testPattern = new RegExp(`${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\.ts)?`, 'i');
        
        if (testPattern.test(messageText)) {
          const context = messageText.toLowerCase();
          let note = '';
          
          // Define status patterns with priorities (check most specific first)
          const statusPatterns = [
            { pattern: /passed\s+on\s+rerun/, status: '✅ resolved' },
            { pattern: /(passed|passing|fixed|resolved|green)/, status: '✅ resolved' },
            { pattern: /not\s+blocking/, status: '✅ not blocking' },
            { pattern: /(explained|setup\s+issue|test\s+issue|just.*issue)/, status: '✅ explained' },
            { pattern: /(fix.*review|should\s+be\s+fixed)/, status: '🔄 fix in progress' },
            { pattern: /revert/, status: '♻️ revert planned/applied' },
            { pattern: /(retry|rerun)/, status: '🔄 rerun in progress' },
            { pattern: /(investigat|working on|looking into|i'll look|as we speak)/, status: '🔍 investigating' },
            { pattern: /still\s+failing/, status: '❌ still failing' }
          ];
          
          // Find first matching pattern
          for (const { pattern, status } of statusPatterns) {
            if (pattern.test(context)) {
              note = status;
              break;
            }
          }
          
          // Most recent status wins - overwrite any previous status for this test
          if (note) perTestStatus[t] = note;
        }
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
      summary += `Failed tests: ${failedTests.slice(0, 3).join(', ')}${failedTests.length > 3 ? '...' : ''}. `;
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
    const fileRegex = /([\w\-\/]+(?:_spec|\.spec|\.test|_test)\.[jt]sx?)/gi;
    const matches = processed.match(fileRegex) || [];
    const normalized = matches.map(m => {
      const cleaned = m.replace(/^\/*/, '');
      const base = cleaned.replace(/^.*[\\\/]/, '');
      return base.replace(/^2f+/i, '');
    });
    return Array.from(new Set(normalized));
  }

  private calculateSectionStatus(perTestStatus: Record<string, string>): string {
    const statuses = Object.values(perTestStatus);
    
    if (statuses.length === 0) {
      return '⏳ Awaiting review';
    }
    
    // Count different status types
    const resolvedCount = statuses.filter(s => 
      s.toLowerCase().includes('resolved') || 
      s.toLowerCase().includes('not blocking') ||
      s.toLowerCase().includes('explained') ||
      s.toLowerCase().includes('fix in progress') ||
      s.toLowerCase().includes('✅')
    ).length;
    
    const investigatingCount = statuses.filter(s => 
      s.toLowerCase().includes('investigating') ||
      s.toLowerCase().includes('🔍') ||
      s.toLowerCase() === 'unclear'
    ).length;
    
    const flakeyCount = statuses.filter(s => 
      s.toLowerCase().includes('flakey') ||
      s.toLowerCase().includes('flaky')
    ).length;
    
    const blockerCount = statuses.filter(s => {
      const statusLower = s.toLowerCase();
      return (statusLower.includes('blocker') || statusLower.includes('blocking')) && 
             !statusLower.includes('not blocking');
    }).length;
    
    // Determine overall section status based on counts
    if (blockerCount > 0) {
      return `🚫 ${blockerCount} blocker${blockerCount > 1 ? 's' : ''} found`;
    } else if (investigatingCount > 0) {
      return `🔍 ${investigatingCount} test${investigatingCount > 1 ? 's' : ''} under investigation`;
    } else if (flakeyCount > 0 && resolvedCount > 0) {
      return `⚠️ ${flakeyCount} flakey, ${resolvedCount} resolved`;
    } else if (flakeyCount > 0) {
      return `⚠️ ${flakeyCount} flakey test${flakeyCount > 1 ? 's' : ''}`;
    } else if (resolvedCount > 0) {
      return `✅ ${resolvedCount} test${resolvedCount > 1 ? 's' : ''} resolved - not blocking`;
    } else {
      return '❓ Status unclear - review needed';
    }
  }
}
