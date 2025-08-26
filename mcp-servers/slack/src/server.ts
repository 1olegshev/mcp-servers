#!/usr/bin/env node

/**
 * Slack MCP Server for Release Management and QA Coordination
 * 
 * AUTHENTICATION ARCHITECTURE:
 * ============================
 * This server uses XOXC/XOXD session-based authentication instead of traditional bot tokens.
 * 
 * AUTHENTICATION FLOW:
 * 1. Extract XOXC token from Slack web session (Authorization header in browser dev tools)
 * 2. Extract XOXD token from 'd' cookie in browser (Application tab → Cookies)
 * 3. Server combines tokens to authenticate as the user session
 * 4. All API calls appear as performed by the token owner
 * 
 * SECURITY MODEL:
 * - Read access: Any channel the user can access (public, private, DMs)
 * - Write access: RESTRICTED to qa-release-status channel only (business requirement)
 * - Token rotation: Manual process when session expires
 * - Audit trail: Actions logged under token owner's name
 * 
 * ENVIRONMENT VARIABLES REQUIRED:
 * - SLACK_XOXC_TOKEN: Session bearer token (xoxc-...)
 * - SLACK_XOXD_TOKEN: Session cookie value (xoxd-...)
 * 
 * BUSINESS LOGIC:
 * - Analyze functional-testing channel for release readiness
 * - Detect auto test results and blocking issues
 * - Post status updates only to authorized release channel
 * - Provide comprehensive release decision support
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { WebClient, ConversationsHistoryResponse, ConversationsListResponse, UsersListResponse } from '@slack/web-api';
import { ErrorCode, McpError, CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { createXOXCWebClient } from './simple-xoxc.js';

// Load environment variables from repo root
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.resolve(__dirname, '../../../.env');
dotenv.config({ path: envPath });

interface ToolArgs {
  channel?: string;
  text?: string;
  thread_ts?: string;
  limit?: number;
  resolve_users?: boolean;
  query?: string;
  timestamp?: string;
  name?: string;
  types?: string;
  date?: string;
  severity?: 'blocking' | 'critical' | 'both';
}

export class SlackMCPServer {
  private server: Server;
  private slack: WebClient;
  private userCache: Map<string, any> = new Map();

  constructor() {
    this.server = new Server(
      {
        name: 'slack-mcp-server',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.slack = this.initializeSlack();
    this.setupHandlers();
  }

  /**
   * Initialize Slack WebClient with session-based authentication
   * 
   * AUTHENTICATION PRIORITY:
   * 1. XOXC/XOXD session tokens (preferred for full access)
   * 2. Legacy bot token (fallback, limited scope)
   * 
   * ENVIRONMENT VARIABLES:
   * - SLACK_MCP_XOXC_TOKEN: Primary session token (xoxc-...)
   * - SLACK_MCP_XOXD_TOKEN: Session validation cookie (xoxd-...)
   * - SLACK_BOT_TOKEN: Fallback bot token (xoxb-...)
   * 
   * SESSION TOKEN ADVANTAGES:
   * - Full user-level permissions
   * - Access to private channels and DMs
   * - No app installation required
   * - Immediate workspace access
   * 
   * SECURITY CONSIDERATIONS:
   * - Tokens represent active user session
   * - Expire when user logs out
   * - All actions attributed to token owner
   * - Should be rotated regularly
   */
  private initializeSlack(): WebClient {
    const xoxc = process.env.SLACK_MCP_XOXC_TOKEN;
    const xoxd = process.env.SLACK_MCP_XOXD_TOKEN;
    const legacyBot = process.env.SLACK_BOT_TOKEN;
    
    if (xoxc) {
      // Use XOXC token with proper headers for session auth
      // This provides full user-level access without bot installation
      return createXOXCWebClient(xoxc, xoxd);
    }

    if (legacyBot) {
      // Fallback to traditional bot token (limited scope)
      return new WebClient(legacyBot);
    }

    throw new McpError(
      ErrorCode.InvalidRequest,
      'Missing Slack authentication. Provide SLACK_MCP_XOXC_TOKEN (+ SLACK_MCP_XOXD_TOKEN) for session auth, or SLACK_BOT_TOKEN for bot auth.'
    );
  }

  private setupHandlers(): void {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: 'send_message',
            description: 'Send a message to a Slack channel',
            inputSchema: {
              type: 'object',
              properties: {
                channel: {
                  type: 'string',
                  description:
                    'Target channel or user. Accepts: channel ID (C123..), #channel-name, @username, U123.. user ID',
                },
                text: {
                  type: 'string',
                  description: 'Message text to send',
                },
                thread_ts: {
                  type: 'string',
                  description: 'Optional: Thread timestamp to reply to',
                },
              },
              required: ['channel', 'text'],
            },
          },
          {
            name: 'list_channels',
            description: 'List all channels in the workspace',
            inputSchema: {
              type: 'object',
              properties: {
                types: {
                  type: 'string',
                  description:
                    'Channel types to include (public_channel,private_channel,im,mpim)',
                  default: 'public_channel,private_channel',
                },
              },
            },
          },
          {
            name: 'get_channel_history',
            description: 'Get recent messages from a channel',
            inputSchema: {
              type: 'object',
              properties: {
                channel: {
                  type: 'string',
                  description:
                    'Channel ID or #channel-name or DM target (@user or U123). Will be resolved to a conversation ID.',
                },
                limit: {
                  type: 'number',
                  description: 'Number of messages to retrieve',
                  default: 10,
                },
                resolve_users: {
                  type: 'boolean',
                  description: 'If true, resolves user IDs to display names',
                  default: false,
                },
              },
              required: ['channel'],
            },
          },
          {
            name: 'search_messages',
            description: 'Search for messages in the workspace',
            inputSchema: {
              type: 'object',
              properties: {
                query: {
                  type: 'string',
                  description: 'Search query',
                },
                channel: {
                  type: 'string',
                  description:
                    'Optional: Channel name to restrict search (e.g., #general). Note: Slack search requires channel name, not ID.',
                },
              },
              required: ['query'],
            },
          },
          {
            name: 'add_reaction',
            description: 'Add a reaction (emoji) to a message',
            inputSchema: {
              type: 'object',
              properties: {
                channel: {
                  type: 'string',
                  description:
                    'Channel ID or #channel-name of the message. DMs also supported (@user or U123).',
                },
                timestamp: {
                  type: 'string',
                  description: 'The message timestamp (ts) to react to',
                },
                name: {
                  type: 'string',
                  description: 'Emoji name without colons (e.g., thumbsup)',
                },
              },
              required: ['channel', 'timestamp', 'name'],
            },
          },
          {
            name: 'get_thread_replies',
            description: 'Get replies from a specific thread',
            inputSchema: {
              type: 'object',
              properties: {
                channel: {
                  type: 'string',
                  description: 'Channel ID or #channel-name',
                },
                thread_ts: {
                  type: 'string',
                  description: 'Thread timestamp to get replies from',
                },
                limit: {
                  type: 'number',
                  description: 'Number of replies to retrieve',
                  default: 50,
                },
              },
              required: ['channel', 'thread_ts'],
            },
          },
          {
            name: 'get_blocking_issues',
            description: 'Find blocking or critical issues in channel for a specific date',
            inputSchema: {
              type: 'object',
              properties: {
                channel: {
                  type: 'string',
                  description: 'Channel to analyze (defaults to functional-testing)',
                  default: 'functional-testing',
                },
                date: {
                  type: 'string',
                  description: 'Date to analyze (YYYY-MM-DD format, defaults to today)',
                },
                severity: {
                  type: 'string',
                  description: 'Issue severity to find',
                  enum: ['blocking', 'critical', 'both'],
                  default: 'both',
                },
              },
            },
          },
          {
            name: 'get_auto_test_status',
            description: 'Analyze auto test results and their review status for a specific date',
            inputSchema: {
              type: 'object',
              properties: {
                channel: {
                  type: 'string',
                  description: 'Channel to analyze (defaults to functional-testing)',
                  default: 'functional-testing',
                },
                date: {
                  type: 'string',
                  description: 'Date to analyze (YYYY-MM-DD format, defaults to today)',
                },
              },
            },
          },
          {
            name: 'get_release_status_overview',
            description: 'Get comprehensive release status overview - answers "Can we release today?"',
            inputSchema: {
              type: 'object',
              properties: {
                channel: {
                  type: 'string',
                  description: 'Channel to analyze (defaults to functional-testing)',
                  default: 'functional-testing',
                },
                date: {
                  type: 'string',
                  description: 'Date to analyze (YYYY-MM-DD format, defaults to today)',
                },
              },
            },
          },
        ],
      };
    });

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      try {
        const { name, arguments: args } = request.params as any;

        switch (name) {
          case 'send_message':
            return await this.sendMessage(args as ToolArgs);
          case 'list_channels':
            return await this.listChannels(args as ToolArgs);
          case 'get_channel_history':
            return await this.getChannelHistory(args as ToolArgs);
          case 'search_messages':
            return await this.searchMessages(args as ToolArgs);
          case 'add_reaction':
            return await this.addReaction(args as ToolArgs);
          case 'get_thread_replies':
            return await this.getThreadReplies(args as ToolArgs);
          case 'get_blocking_issues':
            return await this.getBlockingIssues(args as ToolArgs);
          case 'get_auto_test_status':
            return await this.getAutoTestStatus(args as ToolArgs);
          case 'get_release_status_overview':
            return await this.getReleaseStatusOverview(args as ToolArgs);
          default:
            throw new McpError(
              ErrorCode.MethodNotFound,
              `Unknown tool: ${name}`
            );
        }
      } catch (error: any) {
        if (error instanceof McpError) {
          throw error;
        }
        throw new McpError(
          ErrorCode.InternalError,
          `Error calling tool: ${error.message}`
        );
      }
    });
  }

  // Resolve various channel/user notations to a conversation ID
  private async resolveConversation(target: string): Promise<string> {
    if (!target || typeof target !== 'string') {
      throw new McpError(ErrorCode.InvalidParams, 'channel is required');
    }

    const t = target.trim();
    // If already a conversation ID
    if (/^[CGD][A-Z0-9]+$/.test(t)) {
      return t;
    }

    // If user ID for DM
    if (/^[UW][A-Z0-9]+$/.test(t)) {
      const open = await this.slack.conversations.open({ users: t });
      return (open as any).channel.id as string;
    }

    // @username → DM
    if (t.startsWith('@')) {
      const handle = t.slice(1);
      const user = await this.findUserByHandle(handle);
      if (!user) {
        throw new McpError(ErrorCode.InvalidParams, `User not found: ${t}`);
      }
      const open = await this.slack.conversations.open({ users: user.id });
      return (open as any).channel.id as string;
    }

    // #channel-name or channel-name → channel
    const channelName = t.startsWith('#') ? t.slice(1) : t;
    const channelId = await this.findChannelIdByName(channelName);
    if (!channelId) {
      throw new McpError(ErrorCode.InvalidParams, `Channel not found: ${t}`);
    }
    return channelId;
  }

  private async findChannelIdByName(name: string): Promise<string | null> {
    let cursor: string | undefined;
    do {
      const res = (await this.slack.conversations.list({
        exclude_archived: true,
        limit: 1000,
        types: 'public_channel,private_channel,im,mpim',
        cursor,
      })) as ConversationsListResponse & { response_metadata?: { next_cursor?: string } };
      for (const ch of (res.channels || []) as any[]) {
        if (ch.name === name) return ch.id as string;
      }
      cursor = res.response_metadata?.next_cursor || undefined;
    } while (cursor);
    return null;
  }

  private async findUserByHandle(handle: string): Promise<any | null> {
    // Try cache first
    for (const user of this.userCache.values()) {
      if (user.name === handle || user.profile?.display_name === handle) return user;
    }

    let cursor: string | undefined;
    do {
      const res = (await this.slack.users.list({ limit: 1000, cursor })) as UsersListResponse & {
        response_metadata?: { next_cursor?: string };
      };
      for (const user of (res.members || []) as any[]) {
        this.userCache.set((user as any).id, user);
        if (user.name === handle || user.profile?.display_name === handle) {
          return user as any;
        }
      }
      cursor = res.response_metadata?.next_cursor || undefined;
    } while (cursor);
    return null;
  }

  private async sendMessage(args: ToolArgs) {
    const { channel, text, thread_ts } = args || {};
    if (!channel || !text) {
      throw new McpError(ErrorCode.InvalidParams, 'channel and text are required');
    }

    // BUSINESS REQUIREMENT: Only allow posting to qa-release-status channel
    // This ensures controlled release communication and prevents accidental posts
    const allowedChannels = ['qa-release-status', '#qa-release-status', 'C09BW9Y2HSN'];
    const normalizedChannel = channel.toString().toLowerCase().replace(/^#/, '');
    
    if (!allowedChannels.some(allowed => 
      allowed.toLowerCase().replace(/^#/, '') === normalizedChannel || 
      allowed === channel
    )) {
      throw new McpError(
        ErrorCode.InvalidParams, 
        `Write access restricted: Messages can only be sent to #qa-release-status channel for release coordination. Attempted channel: ${channel}`
      );
    }

    try {
      const conversation = await this.resolveConversation(channel);
      
      const result = await this.slack.chat.postMessage({
        channel: conversation,
        text,
        thread_ts,
      });

      return {
        content: [
          {
            type: 'text',
            text: `Message sent successfully. Channel: ${conversation}, ts: ${result.ts}`,
          },
        ],
      };
    } catch (error: any) {
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to send message: ${error.data?.error || error.message}`
      );
    }
  }

  private async listChannels(args: ToolArgs) {
    const { types = 'public_channel,private_channel' } = args || {};

    try {
      let cursor: string | undefined;
      const channels: Array<{ id: string; name: string; topic: string; purpose: string; num_members?: number }> = [];
      do {
        const result = (await this.slack.conversations.list({
          types,
          limit: 1000,
          cursor,
          exclude_archived: true,
        })) as ConversationsListResponse & { response_metadata?: { next_cursor?: string } };
        for (const ch of (result.channels || []) as any[]) {
          channels.push({
            id: ch.id as string,
            name: ch.name as string,
            topic: ch.topic?.value || '',
            purpose: ch.purpose?.value || '',
            num_members: ch.num_members as number | undefined,
          });
        }
        cursor = result.response_metadata?.next_cursor || undefined;
      } while (cursor);

      return {
        content: [
          {
            type: 'text',
            text: `Found ${channels.length} conversations:\n${channels
              .map((ch) => `• ${ch.name} (${ch.id}) - ${ch.topic || ch.purpose || 'No description'}`)
              .join('\n')}`,
          },
        ],
      };
    } catch (error: any) {
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to list channels: ${error.data?.error || error.message}`
      );
    }
  }

  private async getChannelHistory(args: ToolArgs) {
    const { channel, limit = 10, resolve_users = false } = args || {};
    if (!channel) throw new McpError(ErrorCode.InvalidParams, 'channel is required');

    try {
      const conversation = await this.resolveConversation(channel);
      
      const result = (await this.slack.conversations.history({
        channel: conversation,
        limit,
      })) as ConversationsHistoryResponse;

      let userMap: Record<string, { display: string }> = {};
      if (resolve_users) {
        userMap = await this.buildUserMap();
      }

      const messages = (result.messages || []).map((msg: any) => ({
        user: resolve_users ? userMap[msg.user]?.display || msg.user : msg.user,
        text: msg.text as string,
        timestamp: msg.ts as string,
        thread_ts: msg.thread_ts as string | undefined,
      }));

      return {
        content: [
          {
            type: 'text',
            text: `Last ${messages.length} messages from ${conversation}:\n${messages
              .map(
                (msg: any) =>
                  `[${new Date(parseFloat(msg.timestamp) * 1000).toLocaleString()}] ${msg.user}: ${msg.text}`
              )
              .join('\n')}`,
          },
        ],
      };
    } catch (error: any) {
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to get channel history: ${error.data?.error || error.message}`
      );
    }
  }

  private async searchMessages(args: ToolArgs) {
    const { query, channel } = args || {};
    if (!query) throw new McpError(ErrorCode.InvalidParams, 'query is required');

    try {
      let q = query;
      if (channel) {
        const chName = channel.startsWith('#') ? channel.slice(1) : channel;
        q = `${q} in:${chName}`;
      }

      const result = (await this.slack.search.messages({ query: q, sort: 'score', sort_dir: 'desc' } as any)) as any;
      const matchesRaw = (result.messages?.matches || []) as any[];
      const matches = matchesRaw.map((match) => ({
        channel: match.channel?.name || match.channel?.id,
        user: match.user,
        text: match.text,
        timestamp: match.ts,
      }));

      return {
        content: [
          {
            type: 'text',
            text: `Found ${matches.length} matching messages:\n${matches
              .slice(0, 10)
              .map((m) => `[${m.channel}] ${m.user}: ${m.text}`)
              .join('\n')}${matches.length > 10 ? '\n... and more' : ''}`,
          },
        ],
      };
    } catch (error: any) {
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to search messages: ${error.data?.error || error.message}`
      );
    }
  }

  private async addReaction(args: ToolArgs) {
    const { channel, timestamp, name } = args || {};
    if (!channel || !timestamp || !name) {
      throw new McpError(
        ErrorCode.InvalidParams,
        'channel, timestamp, and name are required'
      );
    }
    
    try {
      const conversation = await this.resolveConversation(channel);
      
      await this.slack.reactions.add({
        channel: conversation,
        timestamp,
        name,
      });
      
      return {
        content: [
          { type: 'text', text: `Added :${name}: to ${conversation} at ${timestamp}` },
        ],
      };
    } catch (error: any) {
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to add reaction: ${error.data?.error || error.message}`
      );
    }
  }

  private async buildUserMap(): Promise<Record<string, { display: string }>> {
    const map: Record<string, { display: string }> = {};
    let cursor: string | undefined;
    do {
      const res = (await this.slack.users.list({ limit: 1000, cursor })) as UsersListResponse & {
        response_metadata?: { next_cursor?: string };
      };
      for (const user of (res.members || []) as any[]) {
        this.userCache.set((user as any).id, user);
        map[(user as any).id] = {
          display: user.profile?.display_name || user.real_name || user.name,
        };
      }
      cursor = res.response_metadata?.next_cursor || undefined;
    } while (cursor);
    return map;
  }

  // Utility methods for date handling
  private getTodayDateString(): string {
    const today = new Date();
    return today.toISOString().split('T')[0]; // YYYY-MM-DD format
  }

  private getDateRange(dateStr?: string): { oldest: string; latest: string } {
    const targetDate = dateStr ? new Date(dateStr) : new Date();
    const startOfDay = new Date(targetDate);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(targetDate);
    endOfDay.setHours(23, 59, 59, 999);

    return {
      oldest: (startOfDay.getTime() / 1000).toString(),
      latest: (endOfDay.getTime() / 1000).toString(),
    };
  }

  // Extract ticket numbers from text (JIRA format)
  private extractTickets(text: string): string[] {
    const ticketPattern = /[A-Z]+-\d+/g;
    return text.match(ticketPattern) || [];
  }

  // Check if text contains blocking/critical keywords
  private analyzeIssueSeverity(text: string): { isBlocking: boolean; isCritical: boolean } {
    const lowerText = text.toLowerCase();
    
    const blockingKeywords = ['blocker', 'blocking', 'release blocker', 'blocks release', 'block release'];
    const criticalKeywords = ['critical', 'urgent', 'high priority', 'must fix', 'critical issue'];
    
    const isBlocking = blockingKeywords.some(keyword => lowerText.includes(keyword));
    const isCritical = criticalKeywords.some(keyword => lowerText.includes(keyword));
    
    return { isBlocking, isCritical };
  }

  // Check if message is from a test bot
  private isTestBot(message: any): boolean {
    // Add known bot patterns - these would need to be refined based on actual bot names
    const botPatterns = [
      'cypress', 'playwright', 'test', 'automation', 'qa',
      'jenkins', 'github', 'gitlab', 'ci/cd', 'build'
    ];
    
    const username = (message.username || message.bot_profile?.name || '').toLowerCase();
    const text = (message.text || '').toLowerCase();
    
    return botPatterns.some(pattern => 
      username.includes(pattern) || text.includes(`${pattern} test`)
    );
  }

  // New tool implementations
  private async getThreadReplies(args: ToolArgs) {
    const { channel, thread_ts, limit = 50 } = args || {};
    if (!channel || !thread_ts) {
      throw new McpError(ErrorCode.InvalidParams, 'channel and thread_ts are required');
    }

    try {
      const conversation = await this.resolveConversation(channel);
      
      const result = await this.slack.conversations.replies({
        channel: conversation,
        ts: thread_ts,
        limit,
      });

      const replies = (result.messages || []).slice(1); // Exclude the parent message
      const formattedReplies = replies.map((msg: any) => ({
        user: msg.user,
        text: msg.text,
        timestamp: msg.ts,
      }));

      return {
        content: [
          {
            type: 'text',
            text: `Found ${formattedReplies.length} replies in thread:\n${formattedReplies
              .map((reply: any) => 
                `[${new Date(parseFloat(reply.timestamp) * 1000).toLocaleString()}] ${reply.user}: ${reply.text}`
              )
              .join('\n')}`,
          },
        ],
      };
    } catch (error: any) {
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to get thread replies: ${error.data?.error || error.message}`
      );
    }
  }

  private async getBlockingIssues(args: ToolArgs) {
    const { channel = 'functional-testing', date, severity = 'both' } = args || {};

    try {
      const conversation = await this.resolveConversation(channel);
      const { oldest, latest } = this.getDateRange(date);
      
      // Get messages for the specified date
      const result = await this.slack.conversations.history({
        channel: conversation,
        oldest,
        latest,
        limit: 200,
      });      const messages = result.messages || [];
      const issues: Array<{
        type: 'blocking' | 'critical';
        text: string;
        tickets: string[];
        timestamp: string;
        hasThread: boolean;
      }> = [];

      // Analyze each message
      for (const message of messages) {
        const text = message.text || '';
        const { isBlocking, isCritical } = this.analyzeIssueSeverity(text);
        
        if ((severity === 'blocking' && isBlocking) || 
            (severity === 'critical' && isCritical) ||
            (severity === 'both' && (isBlocking || isCritical))) {
          
          const tickets = this.extractTickets(text);
          issues.push({
            type: isBlocking ? 'blocking' : 'critical',
            text: text.substring(0, 200) + (text.length > 200 ? '...' : ''),
            tickets,
            timestamp: message.ts!,
            hasThread: !!message.thread_ts || (message.reply_count || 0) > 0,
          });
        }

        // Also check thread replies if message has a thread
        if (message.thread_ts || (message.reply_count || 0) > 0) {
          try {
            const threadResult = await this.slack.conversations.replies({ 
              channel: conversation, 
              ts: message.ts! 
            });
            
            const replies = (threadResult.messages || []).slice(1);
            for (const reply of replies) {
              const replyText = reply.text || '';
              const { isBlocking: replyBlocking, isCritical: replyCritical } = this.analyzeIssueSeverity(replyText);
              
              if ((severity === 'blocking' && replyBlocking) || 
                  (severity === 'critical' && replyCritical) ||
                  (severity === 'both' && (replyBlocking || replyCritical))) {
                
                const replyTickets = this.extractTickets(replyText);
                issues.push({
                  type: replyBlocking ? 'blocking' : 'critical',
                  text: `[Thread Reply] ${replyText.substring(0, 180)}...`,
                  tickets: replyTickets,
                  timestamp: reply.ts!,
                  hasThread: false,
                });
              }
            }
          } catch (error) {
            // Continue if thread reading fails
          }
        }
      }

      const blockingIssues = issues.filter(i => i.type === 'blocking');
      const criticalIssues = issues.filter(i => i.type === 'critical');
      
      let output = `🔍 Issue Analysis for ${date || 'today'} in #${channel}:\n\n`;
      
      if (blockingIssues.length > 0) {
        output += `🚨 BLOCKING ISSUES (${blockingIssues.length}):\n`;
        blockingIssues.forEach((issue, i) => {
          output += `${i + 1}. ${issue.text}\n`;
          if (issue.tickets.length > 0) {
            output += `   Tickets: ${issue.tickets.join(', ')}\n`;
          }
          output += `   Time: ${new Date(parseFloat(issue.timestamp) * 1000).toLocaleString()}\n\n`;
        });
      }
      
      if (criticalIssues.length > 0) {
        output += `⚠️ CRITICAL ISSUES (${criticalIssues.length}):\n`;
        criticalIssues.forEach((issue, i) => {
          output += `${i + 1}. ${issue.text}\n`;
          if (issue.tickets.length > 0) {
            output += `   Tickets: ${issue.tickets.join(', ')}\n`;
          }
          output += `   Time: ${new Date(parseFloat(issue.timestamp) * 1000).toLocaleString()}\n\n`;
        });
      }
      
      if (issues.length === 0) {
        output += `✅ No ${severity === 'both' ? 'blocking or critical' : severity} issues found for this date.`;
      }

      return {
        content: [{ type: 'text', text: output }],
      };
    } catch (error: any) {
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to analyze blocking issues: ${error.data?.error || error.message}`
      );
    }
  }

  private async getAutoTestStatus(args: ToolArgs) {
    const { channel = 'functional-testing', date } = args || {};
    
    try {
      const conversation = await this.resolveConversation(channel);
      const { oldest, latest } = this.getDateRange(date);
      
      // Get messages for the specified date
      const result = await this.slack.conversations.history({
        channel: conversation,
        oldest,
        latest,
        limit: 200,
      });

      const messages = result.messages || [];
      const testResults: Array<{
        type: string;
        status: 'passed' | 'failed' | 'pending';
        text: string;
        timestamp: string;
        hasReview: boolean;
        reviewSummary?: string;
      }> = [];

      // Find test bot messages
      for (const message of messages) {
        if (!this.isTestBot(message)) continue;
        
        const text = message.text || '';
        const lowerText = text.toLowerCase();
        
        // Determine test type
        let testType = 'unknown';
        if (lowerText.includes('cypress') && lowerText.includes('unverified')) {
          testType = 'Cypress Unverified';
        } else if (lowerText.includes('cypress')) {
          testType = 'Cypress General';
        } else if (lowerText.includes('playwright')) {
          testType = 'Playwright';
        }
        
        // Determine status
        let status: 'passed' | 'failed' | 'pending' = 'pending';
        if (lowerText.includes('passed') || lowerText.includes('✅') || lowerText.includes('success')) {
          status = 'passed';
        } else if (lowerText.includes('failed') || lowerText.includes('❌') || lowerText.includes('error')) {
          status = 'failed';
        }
        
        // Check for review in thread if failed
        let hasReview = false;
        let reviewSummary = '';
        if (status === 'failed' && (message.thread_ts || (message.reply_count || 0) > 0)) {
          try {
            const threadResult = await this.slack.conversations.replies({ 
              channel: conversation, 
              ts: message.ts! 
            });
            
            const replies = (threadResult.messages || []).slice(1);
            const reviewTexts = replies.map((r: any) => r.text || '').join(' ').toLowerCase();
            
            if (reviewTexts.includes('reviewed') || 
                reviewTexts.includes('not blocking') || 
                reviewTexts.includes('passed manually') ||
                reviewTexts.includes('approved')) {
              hasReview = true;
              reviewSummary = 'Manual review completed - not blocking';
            } else if (replies.length > 0) {
              hasReview = true;
              reviewSummary = 'Under review';
            }
          } catch (error) {
            // Continue if thread reading fails
          }
        }
        
        if (testType !== 'unknown') {
          testResults.push({
            type: testType,
            status,
            text: text.substring(0, 150) + '...',
            timestamp: message.ts!,
            hasReview,
            reviewSummary,
          });
        }
      }

      // Generate status summary
      let output = `📊 Auto Test Status for ${date || 'today'}:\n\n`;
      
      const cypressUnverified = testResults.find(t => t.type === 'Cypress Unverified');
      const cypressGeneral = testResults.find(t => t.type === 'Cypress General');
      const playwright = testResults.find(t => t.type === 'Playwright');
      
      output += `🔬 Test Results:\n`;
      output += `• Cypress Unverified: ${cypressUnverified ? cypressUnverified.status.toUpperCase() : 'NOT FOUND'}\n`;
      output += `• Cypress General: ${cypressGeneral ? cypressGeneral.status.toUpperCase() : 'NOT FOUND'}\n`;
      output += `• Playwright: ${playwright ? playwright.status.toUpperCase() : 'NOT FOUND'}\n\n`;
      
      const failedTests = testResults.filter(t => t.status === 'failed');
      if (failedTests.length > 0) {
        output += `❌ Failed Tests Requiring Review (${failedTests.length}):\n`;
        failedTests.forEach((test, i) => {
          output += `${i + 1}. ${test.type}: ${test.hasReview ? '✅' : '⏳'} ${test.reviewSummary || 'Pending review'}\n`;
        });
        output += '\n';
      }
      
      // Overall assessment
      const allPassed = testResults.every(t => t.status === 'passed');
      const allReviewed = failedTests.every(t => t.hasReview && t.reviewSummary?.includes('not blocking'));
      
      if (allPassed) {
        output += `✅ AUTO TEST STATUS: ALL PASSED\n`;
      } else if (allReviewed) {
        output += `✅ AUTO TEST STATUS: FAILURES REVIEWED - NOT BLOCKING\n`;
      } else {
        output += `⚠️ AUTO TEST STATUS: PENDING REVIEW\n`;
      }

      return {
        content: [{ type: 'text', text: output }],
      };
    } catch (error: any) {
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to analyze auto test status: ${error.data?.error || error.message}`
      );
    }
  }

  private async getReleaseStatusOverview(args: ToolArgs) {
    const { channel = 'functional-testing', date } = args || {};
    
    try {
      // Get blocking issues
      const blockingResult = await this.getBlockingIssues({ channel, date, severity: 'blocking' });
      const criticalResult = await this.getBlockingIssues({ channel, date, severity: 'critical' });
      const autoTestResult = await this.getAutoTestStatus({ channel, date });
      
      // Extract key information
      const blockingText = blockingResult.content[0].text;
      const criticalText = criticalResult.content[0].text;
      const autoTestText = autoTestResult.content[0].text;
      
      const hasBlockingIssues = blockingText.includes('BLOCKING ISSUES');
      const hasCriticalIssues = criticalText.includes('CRITICAL ISSUES');
      const autoTestsAllPassed = autoTestText.includes('ALL PASSED');
      const autoTestsReviewed = autoTestText.includes('NOT BLOCKING');
      const autoTestsPending = autoTestText.includes('PENDING REVIEW');
      
      // Determine overall status
      let overallStatus = 'READY';
      let statusEmoji = '🟢';
      
      if (hasBlockingIssues) {
        overallStatus = 'BLOCKED';
        statusEmoji = '🔴';
      } else if (autoTestsPending || hasCriticalIssues) {
        overallStatus = 'UNCERTAIN';
        statusEmoji = '🟡';
      }
      
      // Generate comprehensive overview
      let output = `🚦 RELEASE STATUS OVERVIEW - ${date || 'TODAY'}\n`;
      output += `${statusEmoji} STATUS: ${overallStatus}\n\n`;
      
      output += `📊 AUTO TESTS:\n`;
      if (autoTestsAllPassed) {
        output += `✅ All auto tests passed\n`;
      } else if (autoTestsReviewed) {
        output += `✅ Failed tests reviewed and approved\n`;
      } else if (autoTestsPending) {
        output += `⚠️ Failed tests pending review\n`;
      } else {
        output += `❓ Auto test status unclear\n`;
      }
      output += '\n';
      
      if (hasBlockingIssues) {
        output += `🚨 BLOCKING ISSUES FOUND:\n`;
        const blockingLines = blockingText.split('\n').filter(line => 
          line.includes('Tickets:') || line.match(/^\d+\./)
        );
        output += blockingLines.slice(0, 5).join('\n') + '\n\n';
      }
      
      if (hasCriticalIssues) {
        output += `⚠️ CRITICAL ISSUES FOUND:\n`;
        const criticalLines = criticalText.split('\n').filter(line => 
          line.includes('Tickets:') || line.match(/^\d+\./)
        );
        output += criticalLines.slice(0, 5).join('\n') + '\n\n';
      }
      
      // Recommendation
      output += `📋 RECOMMENDATION:\n`;
      if (overallStatus === 'READY') {
        output += `✅ Release can proceed - no blockers detected\n`;
      } else if (overallStatus === 'BLOCKED') {
        output += `❌ Release should be postponed - blocking issues need resolution\n`;
      } else {
        output += `⚠️ Release decision pending - review critical issues and auto test failures\n`;
      }
      
      output += `\n📅 Analysis Date: ${date || this.getTodayDateString()}\n`;
      output += `📺 Channel: #${channel}\n`;

      return {
        content: [{ type: 'text', text: output }],
      };
    } catch (error: any) {
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to generate release status overview: ${error.data?.error || error.message}`
      );
    }
  }

  async run(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('Slack MCP server running on stdio');
  }
}

// Run the server
const server = new SlackMCPServer();
server.run().catch(console.error);
