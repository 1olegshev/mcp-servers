/**
 * Issue Detection Service
 * Analyzes Slack messages for blocking and critical issues
 */

import { SlackClient } from '../clients/slack-client.js';
import { TextAnalyzer } from '../utils/analyzers.js';
import { DateUtils } from '../utils/date-utils.js';
import { Issue, SlackMessage } from '../types/index.js';

export class IssueDetectorService {
  private jiraBaseUrl: string;

  constructor(private slackClient: SlackClient) {
    // Get JIRA base URL from environment for creating ticket links
    this.jiraBaseUrl = process.env.JIRA_BASE_URL || '';
  }

  async findIssues(
    channel: string,
    date?: string,
    severity: 'blocking' | 'critical' | 'both' = 'both',
    messages?: SlackMessage[]
  ): Promise<Issue[]> {
    // Prefer a search-first strategy using severity keywords, then minimal history fallback
    let messagesToAnalyze: SlackMessage[] = [];
    if (messages) {
      messagesToAnalyze = messages;
    } else {
  const { oldest, latest } = DateUtils.getDateRange(date);
  const after = new Date(parseFloat(oldest) * 1000);
  const before = new Date(parseFloat(latest) * 1000);
  const dayAfter = new Date(before.getTime() + 1); // next day start boundary
  const fmt = (d: Date) => d.toISOString().split('T')[0];

      // Build severity query
      const blockingQ = '(blocker OR blocking OR "release blocker" OR "no-go" OR "no go")';
      const criticalQ = '(critical OR urgent OR "high priority")';
      const sevQ = severity === 'blocking' ? blockingQ : severity === 'critical' ? criticalQ : `${blockingQ} OR ${criticalQ}`;

      // Use date bounds in search; Slack supports after:/before:
  // Precise single-day bound: after:DATE before:DATE+1 (Slack search uses date granularity)
  const q = `${sevQ} after:${fmt(after)} before:${fmt(dayAfter)}`;

      try {
        const matches = await this.slackClient.searchMessages(q, channel);
        const seenTs = new Set<string>();
        for (const m of matches) {
          const ts = m.ts as string | undefined;
          if (!ts || seenTs.has(ts)) continue;
          seenTs.add(ts);
          try {
            const full = await this.slackClient.getMessageDetails(channel, ts);
            messagesToAnalyze.push(full as SlackMessage);
          } catch {}
        }
      } catch {}

      // Fallback to minimal history if no matches
      if (messagesToAnalyze.length === 0) {
        const limit = 200; // small window for the day only
        messagesToAnalyze = await this.slackClient.getChannelHistoryForDateRange(channel, oldest, latest, limit);
      }
    }
    
    const issues: Issue[] = [];

    for (const message of messagesToAnalyze) {
      await this.analyzeMessage(message, channel, severity, issues);
    }

    return issues;
  }

  private async analyzeMessage(
    message: SlackMessage, 
    channel: string, 
    severity: string, 
    issues: Issue[]
  ): Promise<void> {
    const text = message.text || '';
    
    // Enhanced issue analysis that returns a detailed status
    const issueAnalysis = await this.analyzeIssueWithContext(message, channel, text);
    
    // Determine if the issue should be included based on its type and the requested severity
    if (issueAnalysis.type !== 'none' && this.shouldIncludeIssue(issueAnalysis.type, severity)) {
      const tickets = TextAnalyzer.extractTickets(text, this.jiraBaseUrl);
      // Deduplicate tickets by key
      const seen = new Set<string>();
      const dedupedTickets = tickets.filter(t => {
        if (seen.has(t.key)) return false;
        seen.add(t.key);
        return true;
      });
      const permalink = await this.slackClient.getPermalink(channel, message.ts!);
      
      issues.push({
        type: issueAnalysis.type,
        text: text.substring(0, 200) + (text.length > 200 ? '...' : ''),
        tickets: dedupedTickets,
        timestamp: message.ts!,
        hasThread: !!message.thread_ts || (message.reply_count || 0) > 0,
        resolutionText: issueAnalysis.resolutionText,
        permalink,
      });
    }
  }

  // This method is now removed as its logic is integrated into analyzeMessage
  // private async analyzeThreadReplies(...) {}

  private shouldIncludeIssue(
    issueType: 'blocking' | 'critical' | 'blocking_resolved' | 'none', 
    severity: string
  ): boolean {
    if (severity === 'both') {
      return issueType !== 'none';
    }
    if (severity === 'blocking') {
      return issueType === 'blocking' || issueType === 'blocking_resolved';
    }
    if (severity === 'critical') {
      return issueType === 'critical';
    }
    return false;
  }

  /**
   * Check for :no-go: emoji reaction on a message
   */
  private async checkForNoGoReaction(message: SlackMessage, channel: string): Promise<boolean> {
    // This is a placeholder - real implementation would need reactions:read scope
    return message.reactions?.some(r => r.name === 'no-go') || false;
  }

  /**
   * Enhanced issue analysis with context from thread and reactions
   * Returns a detailed issue type instead of a simple boolean
   */
  private async analyzeIssueWithContext(
    message: SlackMessage, 
    channel: string, 
    text: string
  ): Promise<{ type: 'blocking' | 'critical' | 'blocking_resolved' | 'none', resolutionText?: string }> {
    const hasNoGoReaction = await this.checkForNoGoReaction(message, channel);
    const { isBlocking: textBlocking, isCritical: textCritical } = TextAnalyzer.analyzeIssueSeverity(text);

    // Initial signals from the parent message
    let indicatedBlocking = textBlocking || hasNoGoReaction || this.hasBlockingIndicators(text);
    let indicatedCritical = textCritical || this.hasCriticalIndicators(text);

    // Always analyze the thread if present to allow replies to override/clarify severity over time
    let threadSeverity: Awaited<ReturnType<IssueDetectorService['analyzeThreadForSeverity']>> = {
      hasBlockingConsensus: false,
      hasCriticalConsensus: false,
      hasResolutionConsensus: false,
      criticalPositive: false,
      criticalNegative: false,
    } as any;
    if (message.thread_ts || (message.reply_count || 0) > 0) {
      try {
        // Compute consensus and polarity from replies
        threadSeverity = await this.analyzeThreadForSeverity(message, channel);
        // Elevate blocking if thread establishes blocking consensus
        if (!indicatedBlocking && threadSeverity.hasBlockingConsensus) {
          indicatedBlocking = true;
        }
        // Replies override parent for critical:
        // - Any clear negation in thread downgrades to non-critical
        // - Elevate only if thread has a clear positive consensus (positive without negation)
        if (threadSeverity.criticalNegative) {
          indicatedCritical = false;
        } else if (!indicatedCritical && threadSeverity.hasCriticalConsensus) {
          indicatedCritical = true;
        }
      } catch {}
    }

    // If still nothing indicates an issue, early return
    if (!indicatedBlocking && !indicatedCritical) {
      return { type: 'none' };
    }

    // If thread indicates resolution for a blocking issue, reflect as blocking_resolved
    if ((message.thread_ts || (message.reply_count || 0) > 0) && threadSeverity.hasResolutionConsensus && indicatedBlocking) {
      return { type: 'blocking_resolved', resolutionText: threadSeverity.resolutionText };
    }

    if (indicatedBlocking) {
      return { type: 'blocking' };
    }
    if (indicatedCritical) {
      return { type: 'critical' };
    }
    return { type: 'none' };
  }

  /**
   * Check for blocking indicators in text
   */
  private hasBlockingIndicators(text: string): boolean {
    const lowerText = text.toLowerCase();
    // Accept explicit signals or release/deploy contexts only; avoid generic 'blocks' (e.g., UI blocks)
    const explicit = /\b(blocker|blocking)\b/i.test(text) || /release\s*blocker/i.test(text);
    const releaseContext = /(\bblock(s)?\b|\bblocking\b).*\b(release|deploy(?:ment)?|prod(?:uction)?)\b/i.test(lowerText);
    const noGo = /no[-_\s]?go/i.test(lowerText);
    return lowerText.includes('@test-managers') || lowerText.includes('hotfix') || explicit || releaseContext || noGo;
  }

  /**
   * Check for critical indicators in text
   */
  private hasCriticalIndicators(text: string): boolean {
    const lower = (text || '').toLowerCase();

    // Negative/mitigating signals (any of these should cancel a positive match)
    const negativeSignals = [
      /\bnot\s+(a\s+)?(super\s+)?high\s+priority\b/i,
      /\bnot\s+urgent\b/i,
      /\bnot\s+critical\b/i,
      /\blow\s+priority\b/i,
      /\bno\s+need\s+to\s+tackle\s+immediately\b/i,
      /\bnot\s+.*tackle\s+immediately\b/i,
      /\bnot\s+immediate(ly)?\b/i,
    ];

    const hasNegative = negativeSignals.some(re => re.test(lower));

    // Positive signals
    const positiveSignals = [
      // "this is critical" / "critical issue" / standalone critical (but not within "not critical")
      /\bcritical(?!\s*path)\b/i,
      /\burgent\b/i,
      /\bhigh\s+priority\b/i,
    ];

    const hasPositive = positiveSignals.some(re => re.test(lower));

    // Only treat as critical if there's a positive indicator and no negation nearby
    if (!hasPositive) return false;
    if (hasNegative) return false;
    
    // Additional windowed negation check: "not ... (critical|urgent|high priority)" within ~4 words
    const windowNegation = /\b(?:not|isn['’]?t|no|doesn['’]?t(?:\s+have)?)\b(?:\W+\w+){0,4}\W+(?:critical|urgent|high\s+priority)\b/i.test(lower);
    if (windowNegation) return false;

    return true;
  }

  /**
   * Analyze thread for severity consensus
   */
  private async analyzeThreadForSeverity(
    message: SlackMessage, 
    channel: string
  ): Promise<{ hasBlockingConsensus: boolean; hasCriticalConsensus: boolean; hasResolutionConsensus: boolean; resolutionText?: string; criticalPositive: boolean; criticalNegative: boolean }> {
    try {
      const replies = await this.slackClient.getThreadReplies(channel, message.ts!);
      let resolutionText = '';
      
      const allThreadText = replies.map(r => {
        const text = r.text || '';
        if (/not.*a?.*block(er|ing)|resolved|fixed|reverted|done/i.test(text)) {
          resolutionText = text;
        }
        return text;
      }).join(' ').toLowerCase();
      
      const hasBlockingConsensus = 
        /\b(blocker|blocking)\b/.test(allThreadText) ||
        /(block|blocks|blocking).*\b(release|deploy(?:ment)?|prod(?:uction)?)\b/.test(allThreadText) ||
        allThreadText.includes('hotfix') ||
        allThreadText.includes('@test-managers') ||
        // consider reactions like :no-go: on replies as blocking signals
        replies.some(r => (r.reactions || []).some(rx => /no[-_ ]?go/i.test(rx.name)));
      
      // Negation-aware critical consensus and polarity flags
      const criticalPositive = /\b(this\s+is\s+)?critical(?!\s*path)\b|\burgent\b|\bhigh\s+priority\b/i.test(allThreadText);
      const criticalNegative = /\bnot\s+(a\s+)?(super\s+)?high\s+priority\b|\bnot\s+critical\b|\bnot\s+urgent\b|\blow\s+priority\b|\bnot\s+.*tackle\s+immediately\b|\bno\s+need\s+to\s+tackle\s+immediately\b|\bnot\s+immediate(ly)?\b/i.test(allThreadText);
      const hasCriticalConsensus = criticalPositive && !criticalNegative;
      
      const hasResolutionConsensus = !!resolutionText;
      
      return { hasBlockingConsensus, hasCriticalConsensus, hasResolutionConsensus, resolutionText, criticalPositive, criticalNegative };
    } catch (error) {
      return { hasBlockingConsensus: false, hasCriticalConsensus: false, hasResolutionConsensus: false, criticalPositive: false, criticalNegative: false };
    }
  }

  formatIssuesReport(issues: Issue[], date?: string, channel = 'functional-testing'): string {
  const blockingIssues = issues.filter(i => i.type === 'blocking');
  const criticalIssues = issues.filter(i => i.type === 'critical');
    
  let output = `🔍 Issue Analysis for ${date || 'today'} in #${channel}:\n\n`;
    
    // Summary line
    const summary = [];
    if (blockingIssues.length > 0) summary.push(`${blockingIssues.length} blocker${blockingIssues.length !== 1 ? 's' : ''}`);
    if (criticalIssues.length > 0) summary.push(`${criticalIssues.length} critical`);
    
    if (summary.length > 0) {
      output += `• **Summary**: ${summary.join(', ')} found\n\n`;
    }
    
    if (blockingIssues.length > 0) {
      output += `🚨 **BLOCKING ISSUES** (${blockingIssues.length}):\n`;
      output += `*Issues that block release deployment*\n\n`;
      
      blockingIssues.forEach((issue, i) => {
        output += `**${i + 1}. Blocker Report**\n`;
        output += `${issue.text}\n`;
        output += `⏰ ${DateUtils.formatTimestamp(issue.timestamp)}\n`;
        if (issue.permalink) {
          const label = issue.hasThread ? 'Open thread' : 'Open message';
          output += `🔗 <${issue.permalink}|${label}>\n`;
        }
        
        if (issue.tickets.length > 0) {
          // Safety dedup at presentation time
          const uniq = new Map(issue.tickets.map(t => [t.key, t]));
          output += `🎫 **Related Tickets**:\n`;
          Array.from(uniq.values()).forEach(ticket => {
            const projectText = ticket.project ? ` | 📁 ${ticket.project}` : '';
            const linkText = ticket.url ? ` | 🔗 [Open](${ticket.url})` : '';
            output += `   • **${ticket.key}**${projectText}${linkText}\n`;
          });
        }
        
        if (issue.hasThread) {
          output += `💬 *Has thread discussion - check for resolution status*\n`;
        }
        
        output += '\n---\n\n';
      });
    }
    
    if (criticalIssues.length > 0) {
      output += `⚠️ **CRITICAL ISSUES** (${criticalIssues.length}):\n`;
      output += `*High priority issues requiring attention*\n\n`;
      
      criticalIssues.forEach((issue, i) => {
        output += `**${i + 1}. Critical Report**\n`;
        output += `${issue.text}\n`;
        output += `⏰ ${DateUtils.formatTimestamp(issue.timestamp)}\n`;
        if (issue.permalink) {
          const label = issue.hasThread ? 'Open thread' : 'Open message';
          output += `🔗 <${issue.permalink}|${label}>\n`;
        }
        
        if (issue.tickets.length > 0) {
          const uniq = new Map(issue.tickets.map(t => [t.key, t]));
          output += `🎫 **Related Tickets**:\n`;
          Array.from(uniq.values()).forEach(ticket => {
            const projectText = ticket.project ? ` | 📁 ${ticket.project}` : '';
            const linkText = ticket.url ? ` | 🔗 [Open](${ticket.url})` : '';
            output += `   • **${ticket.key}**${projectText}${linkText}\n`;
          });
        }
        
        if (issue.hasThread) {
          output += `💬 *Has thread discussion - check for resolution status*\n`;
        }
        
        output += '\n---\n\n';
      });
    }
    
    if (issues.length === 0) {
      output += `✅ *No blocking or critical issues found*\n`;
      output += `Release deployment can proceed from issue perspective.`;
    } else {
      output += `\n📋 *Action Required:*\n`;
      if (blockingIssues.length > 0) {
        output += `• Review ${blockingIssues.length} blocking issue${blockingIssues.length !== 1 ? 's' : ''} - must be resolved before release\n`;
      }
      if (criticalIssues.length > 0) {
        output += `• Monitor ${criticalIssues.length} critical issue${criticalIssues.length !== 1 ? 's' : ''} - may impact release timeline\n`;
      }
    }

    return output;
  }
}