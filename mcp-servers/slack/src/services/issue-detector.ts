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

  /**
   * Extract thread_ts from permalink URL if not present in message object
   * Slack search API sometimes doesn't populate thread_ts field but includes it in permalink
   */
  private extractThreadTsFromPermalink(message: any): string | undefined {
    if (message.thread_ts) {
      return message.thread_ts;
    }

    // Try to extract from permalink: /archives/CHANNEL/pTIMESTAMP?thread_ts=THREAD_TS
    const permalink = message.permalink;
    if (permalink) {
      const threadTsMatch = permalink.match(/[?&]thread_ts=([^&]+)/);
      if (threadTsMatch) {
        return threadTsMatch[1];
      }
    }

    return undefined;
  }

  async findIssues(
    channel: string,
    date?: string,
    severity: 'blocking' | 'critical' | 'both' = 'both'
  ): Promise<Issue[]> {
    // Step 1: Initial Sweep with `search` to find "seed" messages
    const { oldest, latest } = DateUtils.getDateRange(date);
    const after = new Date(parseFloat(oldest) * 1000);
    const before = new Date(parseFloat(latest) * 1000);
    const dayAfter = new Date(before.getTime() + 1);
    const fmt = (d: Date) => d.toISOString().split('T')[0];
    const dateQuery = date === 'today' || !date ? 'on:today' : `after:${fmt(after)} before:${fmt(dayAfter)}`;
    
    const searches = [
      `"release blocker" ${dateQuery}`,
      `blocker ${dateQuery}`,
      `blocking ${dateQuery}`,
      `critical ${dateQuery}`,
      `urgent ${dateQuery}`,
      `hotfix ${dateQuery}`,
      `"no go" ${dateQuery}`,
    ];


    let seedMessages: SlackMessage[] = [];
    try {
      const searchPromises = searches.map(query => this.slackClient.searchMessages(query, channel));
      const results = await Promise.allSettled(searchPromises);
      const seenTs = new Set<string>();

      for (const result of results) {
        if (result.status === 'fulfilled') {
          for (const m of result.value) {
            if (m.ts && !seenTs.has(m.ts)) {
              seenTs.add(m.ts);
              seedMessages.push(m as SlackMessage);
            }
          }
        }
      }
    } catch (e) {
      console.error('An error occurred during the search phase:', e);
      return [];
    }

    // Step 1.5: Filter out seed messages containing any negative phrase
    const negativePhrases = [
      'not blocking',
      'not a blocker',
      'not urgent',
      'not critical',
      'not super high priority',
      'low priority',
      'no need to tackle immediately',
      'not tackle immediately',
      'not immediately',
      'no longer blocking'
    ];

    seedMessages = seedMessages.filter(msg => {
      const text = (msg.text || '').toLowerCase();
      return !negativePhrases.some(phrase => text.includes(phrase));
    });

    // Step 2: Identify Unique Relevant Threads from Seeds
    const relevantThreadIds = new Set<string>();
    for (const message of seedMessages) {
      // Use helper to extract thread_ts from permalink if not in message object
      const extractedThreadTs = this.extractThreadTsFromPermalink(message);
      const threadId = extractedThreadTs || message.ts!;
      relevantThreadIds.add(threadId);
    }

    const allIssues: Issue[] = [];

    // Step 3: Fetch Full, Guaranteed Context and Analyze Each Thread
    for (const threadId of relevantThreadIds) {
      let fullThreadMessages: SlackMessage[] = [];
      let parentMessage: SlackMessage;

      try {
        // Fetch the parent message details directly. This is our anchor.
        parentMessage = await this.slackClient.getMessageDetails(channel, threadId);
        // Then, fetch the replies for that thread.
        fullThreadMessages = await this.slackClient.getThreadReplies(channel, threadId);
        // Ensure the parent is part of the full text for ticket extraction
        if (!fullThreadMessages.some(m => m.ts === parentMessage.ts)) {
            fullThreadMessages.unshift(parentMessage);
        }
      } catch (e) {
        console.error(`Failed to fetch full context for thread ${threadId}:`, e);
        continue; // Skip this thread if we can't get its full context
      }

      // Step 4: Apply Analysis Logic to the Full Thread Context
      // We pass the parent message to analysis, which can then correctly re-fetch the thread if needed.
      const issueAnalysis = await this.analyzeIssueWithContext(parentMessage, channel, parentMessage.text || '');

      if (issueAnalysis.type === 'none' || !this.shouldIncludeIssue(issueAnalysis.type, severity)) {
        continue;
      }

      // To extract tickets, we need the text of all messages in the thread.
      const fullThreadText = fullThreadMessages.map(m => m.text || '').filter(Boolean).join(' ');
      const tickets = TextAnalyzer.extractTickets(fullThreadText, this.jiraBaseUrl);
      const dedupedTickets = Array.from(new Map(tickets.map(t => [t.key, t])).values());
      const permalink = await this.slackClient.getPermalink(channel, parentMessage.ts!);

      allIssues.push({
        type: issueAnalysis.type,
        text: (parentMessage.text || '').substring(0, 200) + ((parentMessage.text || '').length > 200 ? '...' : ''),
        tickets: dedupedTickets,
        timestamp: parentMessage.ts!,
        hasThread: fullThreadMessages.length > 1,
        resolutionText: issueAnalysis.resolutionText,
        permalink,
      });
    }

    // Step 5: Final Deduplication by Ticket (first mention per ticket/thread)
    const ticketToIssue = new Map<string, Issue>();
    const threadToTicket = new Map<string, Set<string>>();

    for (const issue of allIssues) {
      // For each ticket in this issue, if not already mapped, map to this issue (first mention wins)
      for (const ticket of issue.tickets) {
        if (!ticketToIssue.has(ticket.key)) {
          ticketToIssue.set(ticket.key, issue);
        }
        // Track which tickets are mentioned in which threads
        const threadId = issue.timestamp;
        if (!threadToTicket.has(threadId)) {
          threadToTicket.set(threadId, new Set());
        }
        threadToTicket.get(threadId)!.add(ticket.key);
      }
    }

    // Prepare final deduped list: one issue per unique ticket, with thread link from first mention
    const dedupedIssues: Issue[] = Array.from(ticketToIssue.values());
    return dedupedIssues;
  }

  // analyzeMessage is now removed as its logic is integrated into findIssues


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
   * Analyze thread for severity consensus using chronological processing
   * Most recent messages have priority over earlier ones
   */
  private async analyzeThreadForSeverity(
    message: SlackMessage, 
    channel: string
  ): Promise<{ hasBlockingConsensus: boolean; hasCriticalConsensus: boolean; hasResolutionConsensus: boolean; resolutionText?: string; criticalPositive: boolean; criticalNegative: boolean }> {
    try {
      const replies = await this.slackClient.getThreadReplies(channel, message.ts!);
      
      // Helper to extract all text from a message including blocks/attachments
      const collectText = (m: SlackMessage) => {
        const parts: string[] = [];
        if (m.text) parts.push(m.text);
        // TODO: Add block/attachment text extraction if needed
        return parts.filter(Boolean).join(' ');
      };

      // Process messages chronologically - most recent status wins
      const allMessages = [message, ...replies];
      let resolutionText = '';
      let currentBlockingStatus = false;
      let currentCriticalStatus = false;
      let hasBlockingMention = false;
      let hasCriticalMention = false;
      
      // Priority-based pattern matching arrays
      const resolutionPatterns = [
        { pattern: /not.*a?.*block(er|ing)/i, type: 'resolution' },
        { pattern: /resolved|fixed|reverted|done|closed/i, type: 'resolution' },
        { pattern: /fix\s+(is\s+)?(ready|complete|deployed|merged)/i, type: 'resolution' },
        { pattern: /(ready|complete).*hotfix/i, type: 'resolution' },
        { pattern: /hotfix.*ready/i, type: 'resolution' },
        { pattern: /start.*hotfix/i, type: 'resolution' },
        { pattern: /no longer blocking/i, type: 'resolution' },
        { pattern: /issue.*resolved/i, type: 'resolution' },
        { pattern: /(pr|pull\s+request).*merged/i, type: 'resolution' },
        { pattern: /deployed.*fix/i, type: 'resolution' }
      ];
      
      const blockingPatterns = [
        { pattern: /release\s*blocker/i, type: 'blocking', priority: 10 },
        { pattern: /\b(blocker|blocking)\b/i, type: 'blocking', priority: 9 },
        { pattern: /(block|blocks|blocking).*\b(release|deploy(?:ment)?|prod(?:uction)?)\b/i, type: 'blocking', priority: 8 },
        { pattern: /hotfix(?!.*ready|.*start)/i, type: 'blocking', priority: 7 }, // hotfix but not when it's ready or starting
        { pattern: /@test-managers/i, type: 'blocking', priority: 6 },
        { pattern: /no[-_\s]?go/i, type: 'blocking', priority: 5 }
      ];
      
      const criticalPatterns = [
        { pattern: /\bcritical(?!\s*path)\b/i, type: 'critical', priority: 10 },
        { pattern: /\burgent\b/i, type: 'critical', priority: 9 },
        { pattern: /\bhigh\s+priority\b/i, type: 'critical', priority: 8 },
        { pattern: /\bsuper\s+high\s+priority\b/i, type: 'critical', priority: 11 }
      ];
      
      const criticalNegationPatterns = [
        { pattern: /\bnot\s+(a\s+)?(super\s+)?high\s+priority\b/i, type: 'critical_negation' },
        { pattern: /\bnot\s+critical\b/i, type: 'critical_negation' },
        { pattern: /\bnot\s+urgent\b/i, type: 'critical_negation' },
        { pattern: /\blow\s+priority\b/i, type: 'critical_negation' },
        { pattern: /\bnot\s+.*tackle\s+immediately\b/i, type: 'critical_negation' },
        { pattern: /\bno\s+need\s+to\s+tackle\s+immediately\b/i, type: 'critical_negation' },
        { pattern: /\bnot\s+immediate(ly)?\b/i, type: 'critical_negation' }
      ];

      // Process each message chronologically
      for (const msg of allMessages) {
        const text = collectText(msg);
        const lowerText = text.toLowerCase();
        
        // Check for resolution patterns - these override blocking status
        for (const { pattern } of resolutionPatterns) {
          if (pattern.test(text)) {
            resolutionText = text;
            currentBlockingStatus = false; // Resolution overrides blocking
            break;
          }
        }
        
        // Check for blocking patterns
        for (const { pattern } of blockingPatterns) {
          if (pattern.test(text)) {
            hasBlockingMention = true;
            if (!resolutionText) { // Only set blocking if not resolved
              currentBlockingStatus = true;
            }
            break;
          }
        }
        
        // Check for critical patterns and negations
        let foundCritical = false;
        let foundCriticalNegation = false;
        
        for (const { pattern } of criticalPatterns) {
          if (pattern.test(text)) {
            hasCriticalMention = true;
            foundCritical = true;
            break;
          }
        }
        
        for (const { pattern } of criticalNegationPatterns) {
          if (pattern.test(text)) {
            foundCriticalNegation = true;
            break;
          }
        }
        
        // Update critical status based on this message
        if (foundCriticalNegation) {
          currentCriticalStatus = false; // Negation always wins
        } else if (foundCritical) {
          currentCriticalStatus = true;
        }
        
        // Check for :no-go: reactions as blocking signals
        if ((msg.reactions || []).some(rx => /no[-_ ]?go/i.test(rx.name || ''))) {
          hasBlockingMention = true;
          if (!resolutionText) {
            currentBlockingStatus = true;
          }
        }
      }
      
      const hasBlockingConsensus = currentBlockingStatus;
      const hasCriticalConsensus = currentCriticalStatus && hasCriticalMention;
      const hasResolutionConsensus = !!resolutionText;
      
      return { 
        hasBlockingConsensus, 
        hasCriticalConsensus, 
        hasResolutionConsensus, 
        resolutionText, 
        criticalPositive: hasCriticalMention, 
        criticalNegative: !currentCriticalStatus && hasCriticalMention 
      };
    } catch (error) {
      return { hasBlockingConsensus: false, hasCriticalConsensus: false, hasResolutionConsensus: false, criticalPositive: false, criticalNegative: false };
    }
  }

  formatIssuesReport(issues: Issue[], date?: string, channel = 'functional-testing'): string {
  const blockingIssues = issues.filter(i => i.type === 'blocking');
  const criticalIssues = issues.filter(i => i.type === 'critical');
  const resolvedBlockers = issues.filter(i => i.type === 'blocking_resolved');

  let output = `🔍 Issue Analysis for ${date || 'today'} in #${channel}:\n\n`;

    // Summary line
    const summary = [];
    if (blockingIssues.length > 0) summary.push(`${blockingIssues.length} blocker${blockingIssues.length !== 1 ? 's' : ''}`);
    if (criticalIssues.length > 0) summary.push(`${criticalIssues.length} critical`);
    if (resolvedBlockers.length > 0) summary.push(`${resolvedBlockers.length} resolved blocker${resolvedBlockers.length !== 1 ? 's' : ''}`);

    if (summary.length > 0) {
      output += `• **Summary**: ${summary.join(', ')} found\n\n`;
    }
    
    if (blockingIssues.length > 0) {
      output += `🚨 **BLOCKING ISSUES** (${blockingIssues.length}):\n`;
      output += `*Issues that block release deployment*\n\n`;
      
      blockingIssues.forEach((issue, i) => {
        output += `**${i + 1}. Blocker**\n`;
        
        if (issue.tickets.length > 0) {
          // Safety dedup at presentation time
          const uniq = new Map(issue.tickets.map(t => [t.key, t]));
          output += `🎫 **Tickets**: `;
          const ticketLinks = Array.from(uniq.values()).map(ticket => {
            return ticket.url ? `[${ticket.key}](${ticket.url})` : ticket.key;
          });
          output += ticketLinks.join(', ') + '\n';
        }
        
        if (issue.permalink) {
          const label = issue.hasThread ? 'Open thread' : 'Open message';
          output += `� <${issue.permalink}|${label}>\n`;
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

    if (resolvedBlockers.length > 0) {
      output += `🟠 **RESOLVED BLOCKERS** (${resolvedBlockers.length}):\n`;
      output += `*Previously blocking issues that have been resolved*\n\n`;

      resolvedBlockers.forEach((issue, i) => {
        output += `**${i + 1}. Resolved Blocker**\n`;

        if (issue.tickets.length > 0) {
          const uniq = new Map(issue.tickets.map(t => [t.key, t]));
          output += `🎫 **Tickets**: `;
          const ticketLinks = Array.from(uniq.values()).map(ticket => {
            return ticket.url ? `[${ticket.key}](${ticket.url})` : ticket.key;
          });
          output += ticketLinks.join(', ') + '\n';
        }

        if (issue.resolutionText) {
          output += `✅ **Resolution**: ${issue.resolutionText.substring(0, 100)}${issue.resolutionText.length > 100 ? '...' : ''}\n`;
        }

        if (issue.permalink) {
          const label = issue.hasThread ? 'Open thread' : 'Open message';
          output += `🔗 <${issue.permalink}|${label}>\n`;
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
      if (resolvedBlockers.length > 0) {
        output += `• Verify ${resolvedBlockers.length} resolved blocker${resolvedBlockers.length !== 1 ? 's' : ''} - ensure resolution is complete\n`;
      }
    }

    return output;
  }
}