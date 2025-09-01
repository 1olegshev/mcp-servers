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
    // Use provided messages or fetch them with optimized parameters
    let messagesToAnalyze: SlackMessage[];
    if (messages) {
      messagesToAnalyze = messages;
    } else {
      const { oldest, latest } = DateUtils.getDateRange(date);
      // OPTIMIZATION: Reduce limit from 200 to 50 for today-only queries
      const limit = date ? 200 : 50; // Less messages for "today" queries
      messagesToAnalyze = await this.slackClient.getChannelHistoryForDateRange(channel, oldest, latest, limit);
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
      
      issues.push({
        type: issueAnalysis.type,
        text: text.substring(0, 200) + (text.length > 200 ? '...' : ''),
        tickets,
        timestamp: message.ts!,
        hasThread: !!message.thread_ts || (message.reply_count || 0) > 0,
        resolutionText: issueAnalysis.resolutionText,
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
    
    const isPotentiallyBlocking = textBlocking || hasNoGoReaction || this.hasBlockingIndicators(text);
    const isPotentiallyCritical = textCritical || this.hasCriticalIndicators(text);

    if (!isPotentiallyBlocking && !isPotentiallyCritical) {
      return { type: 'none' };
    }

    // If there's a thread, check for resolution context
    if (message.thread_ts || (message.reply_count || 0) > 0) {
      const threadAnalysis = await this.analyzeThreadForSeverity(message, channel);
      
      if (isPotentiallyBlocking && threadAnalysis.hasResolutionConsensus) {
        return { type: 'blocking_resolved', resolutionText: threadAnalysis.resolutionText };
      }
    }
    
    if (isPotentiallyBlocking) {
      return { type: 'blocking' };
    }
    
    if (isPotentiallyCritical) {
      return { type: 'critical' };
    }

    return { type: 'none' };
  }

  /**
   * Check for blocking indicators in text
   */
  private hasBlockingIndicators(text: string): boolean {
    const lowerText = text.toLowerCase();
    
    return lowerText.includes('@test-managers') ||
           lowerText.includes('hotfix') ||
           /block(ing|er|s)/i.test(text) ||
           /no.?go/i.test(text);
  }

  /**
   * Check for critical indicators in text
   */
  private hasCriticalIndicators(text: string): boolean {
    const lowerText = text.toLowerCase();
    
    return lowerText.includes('critical') ||
           lowerText.includes('urgent') ||
           lowerText.includes('high priority');
  }

  /**
   * Analyze thread for severity consensus
   */
  private async analyzeThreadForSeverity(
    message: SlackMessage, 
    channel: string
  ): Promise<{ hasBlockingConsensus: boolean; hasCriticalConsensus: boolean; hasResolutionConsensus: boolean; resolutionText?: string }> {
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
        /this.*is.*a?.*block(er|ing)/i.test(allThreadText) ||
        /blocking.*release/i.test(allThreadText) ||
        /should.*block/i.test(allThreadText) ||
        allThreadText.includes('hotfix') ||
        allThreadText.includes('@test-managers');
      
      const hasCriticalConsensus = 
        /this.*is.*critical/i.test(allThreadText) ||
        /critical.*issue/i.test(allThreadText);
      
      const hasResolutionConsensus = !!resolutionText;
      
      return { hasBlockingConsensus, hasCriticalConsensus, hasResolutionConsensus, resolutionText };
    } catch (error) {
      return { hasBlockingConsensus: false, hasCriticalConsensus: false, hasResolutionConsensus: false };
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
      output += `� **Summary**: ${summary.join(', ')} found\n\n`;
    }
    
    if (blockingIssues.length > 0) {
      output += `�🚨 **BLOCKING ISSUES** (${blockingIssues.length}):\n`;
      output += `*Issues that block release deployment*\n\n`;
      
      blockingIssues.forEach((issue, i) => {
        output += `**${i + 1}. Blocker Report**\n`;
        output += `${issue.text}\n`;
        output += `⏰ ${DateUtils.formatTimestamp(issue.timestamp)}\n`;
        
        if (issue.tickets.length > 0) {
          output += `🎫 **Related Tickets**:\n`;
          issue.tickets.forEach(ticket => {
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
        
        if (issue.tickets.length > 0) {
          output += `🎫 **Related Tickets**:\n`;
          issue.tickets.forEach(ticket => {
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
      output += `✅ **No blocking or critical issues found**\n`;
      output += `Release deployment can proceed from issue perspective.`;
    } else {
      output += `\n📋 **Action Required:**\n`;
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