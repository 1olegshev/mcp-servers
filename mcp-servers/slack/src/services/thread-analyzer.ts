import { SlackClient } from '../clients/slack-client.js';
import { SlackMessage } from '../types/index.js';
import { extractAllMessageText } from '../utils/message-extractor.js';

export class ThreadAnalyzerService {
  constructor(private slackClient: SlackClient) {}

  async checkForReview(
    message: SlackMessage,
    channel: string,
    status: string
  ): Promise<{ hasReview: boolean; summary: string; failedTests?: string[]; statusNote?: string; perTestStatus?: Record<string, string> }> {
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
      };
    } catch (error) {
      console.error('Failed to check test review:', error);
    }

    return { hasReview: false, summary: '', failedTests: [], statusNote: '', perTestStatus: {} };
  }

  private analyzeThreadContent(
    replies: SlackMessage[],
    originalMessage: SlackMessage
  ): { hasActivity: boolean; summary: string; failedTests: string[]; statusNote: string; perTestStatus: Record<string, string> } {
    if (replies.length === 0) {
      return { hasActivity: false, summary: '', failedTests: [], statusNote: '', perTestStatus: {} };
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
    for (const t of normalizedFailed) {
      const tEsc = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const patt = new RegExp(`${tEsc}[^\n]{0,80}(passed|fixed|resolved|green|not blocking|revert|retry|rerun|investigat|still failing)`, 'i');
      const m = (threadTexts.join('\n')).match(patt);
      if (m) {
        const kw = m[1].toLowerCase();
        let note = '';
        if (/(passed|fixed|resolved|green)/.test(kw)) note = '✅ resolved';
        else if (/not\s+blocking/.test(kw)) note = '✅ not blocking';
        else if (/revert/.test(kw)) note = '♻️ revert planned/applied';
        else if (/(retry|rerun)/.test(kw)) note = '🔄 rerun in progress';
        else if (/investigat/.test(kw)) note = '🔍 investigating';
        else if (/still\s+failing/.test(kw)) note = '❌ still failing';
        if (note) perTestStatus[t] = note;
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

    return {
      hasActivity: true,
      summary: summary.trim(),
      failedTests: normalizedFailed,
      statusNote: statusNote.trim(),
      perTestStatus,
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
}
