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
    severity: 'blocking' | 'critical' | 'both' = 'both'
  ): Promise<Issue[]> {
    const { oldest, latest } = DateUtils.getDateRange(date);
    const messages = await this.slackClient.getChannelHistoryForDateRange(channel, oldest, latest);
    
    const issues: Issue[] = [];

    for (const message of messages) {
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
    
    // Check for reactions (especially :no-go:)
    const hasNoGoReaction = await this.checkForNoGoReaction(message, channel);
    
    // Enhanced issue analysis
    const issueAnalysis = await this.analyzeIssueWithContext(message, channel, text, hasNoGoReaction);
    
    if (this.shouldIncludeIssue(issueAnalysis.isBlocking, issueAnalysis.isCritical, severity)) {
      const tickets = TextAnalyzer.extractTickets(text, this.jiraBaseUrl);
      issues.push({
        type: issueAnalysis.isBlocking ? 'blocking' : 'critical',
        text: text.substring(0, 200) + (text.length > 200 ? '...' : ''),
        tickets,
        timestamp: message.ts!,
        hasThread: !!message.thread_ts || (message.reply_count || 0) > 0,
      });
    }

    // Check thread replies for issues
    if (message.thread_ts || (message.reply_count || 0) > 0) {
      await this.analyzeThreadReplies(message, channel, severity, issues);
    }
  }

  private async analyzeThreadReplies(
    message: SlackMessage,
    channel: string,
    severity: string,
    issues: Issue[]
  ): Promise<void> {
    try {
      const replies = await this.slackClient.getThreadReplies(channel, message.ts!);
      
      for (const reply of replies) {
        const replyText = reply.text || '';
        
        // Use enhanced analysis for thread replies too
        const issueAnalysis = await this.analyzeIssueWithContext(reply, channel, replyText, false);
        
        if (this.shouldIncludeIssue(issueAnalysis.isBlocking, issueAnalysis.isCritical, severity)) {
          const tickets = TextAnalyzer.extractTickets(replyText, this.jiraBaseUrl);
          issues.push({
            type: issueAnalysis.isBlocking ? 'blocking' : 'critical',
            text: `[Thread Reply] ${replyText.substring(0, 180)}...`,
            tickets,
            timestamp: reply.ts!,
            hasThread: false,
          });
        }
      }
    } catch (error) {
      // Continue if thread reading fails
      console.error('Failed to read thread replies:', error);
    }
  }

  private shouldIncludeIssue(isBlocking: boolean, isCritical: boolean, severity: string): boolean {
    return (severity === 'blocking' && isBlocking) || 
           (severity === 'critical' && isCritical) ||
           (severity === 'both' && (isBlocking || isCritical));
  }

  /**
   * Check for :no-go: emoji reaction on a message
   */
  private async checkForNoGoReaction(message: SlackMessage, channel: string): Promise<boolean> {
    try {
      // Note: This would require reactions API access
      // For now, we'll rely on thread analysis and text patterns
      return false;
    } catch (error) {
      return false;
    }
  }

  /**
   * Enhanced issue analysis with context from thread and reactions
   */
  private async analyzeIssueWithContext(
    message: SlackMessage, 
    channel: string, 
    text: string, 
    hasNoGoReaction: boolean
  ): Promise<{ isBlocking: boolean; isCritical: boolean }> {
    
    // Start with basic text analysis
    const { isBlocking: textBlocking, isCritical: textCritical } = TextAnalyzer.analyzeIssueSeverity(text);
    
    // Enhanced detection patterns
    const enhancedBlocking = textBlocking || 
      hasNoGoReaction ||
      this.hasBlockingIndicators(text);
    
    const enhancedCritical = textCritical || 
      this.hasCriticalIndicators(text);
    
    // Check thread for consensus if available
    if (message.thread_ts || (message.reply_count || 0) > 0) {
      const threadAnalysis = await this.analyzeThreadForSeverity(message, channel);
      
      // Thread consensus overrides initial indicators
      if (threadAnalysis.hasBlockingConsensus) {
        return { isBlocking: true, isCritical: false };
      } else if (threadAnalysis.hasCriticalConsensus) {
        return { isBlocking: false, isCritical: true };
      } else if (threadAnalysis.hasResolutionConsensus) {
        return { isBlocking: false, isCritical: false };
      }
    }
    
    return { isBlocking: enhancedBlocking, isCritical: enhancedCritical };
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
  ): Promise<{ hasBlockingConsensus: boolean; hasCriticalConsensus: boolean; hasResolutionConsensus: boolean }> {
    try {
      const replies = await this.slackClient.getThreadReplies(channel, message.ts!);
      const allThreadText = replies.map(r => r.text || '').join(' ').toLowerCase();
      
      const hasBlockingConsensus = 
        /this.*is.*a?.*block(er|ing)/i.test(allThreadText) ||
        /blocking.*release/i.test(allThreadText) ||
        /should.*block/i.test(allThreadText) ||
        allThreadText.includes('hotfix') ||
        allThreadText.includes('@test-managers');
      
      const hasCriticalConsensus = 
        /this.*is.*critical/i.test(allThreadText) ||
        /critical.*issue/i.test(allThreadText);
      
      const hasResolutionConsensus = 
        /not.*a?.*block(er|ing)/i.test(allThreadText) ||
        /resolved/i.test(allThreadText) ||
        /fixed/i.test(allThreadText) ||
        /no.*longer.*blocking/i.test(allThreadText);
      
      return { hasBlockingConsensus, hasCriticalConsensus, hasResolutionConsensus };
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