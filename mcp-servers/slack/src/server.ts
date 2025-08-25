#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { WebClient, ConversationsHistoryResponse, ConversationsListResponse, UsersListResponse } from '@slack/web-api';
import { ErrorCode, McpError, CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Load environment variables from repo root (two levels up from this file)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// When compiled, __dirname points to .../slack/dist, so go up three levels to repo root
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

  private initializeSlack(): WebClient {
    const token = process.env.SLACK_BOT_TOKEN;
    if (!token) {
      throw new McpError(
        ErrorCode.InvalidRequest,
        'SLACK_BOT_TOKEN environment variable is required'
      );
    }
    return new WebClient(token);
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
            text: `Message sent successfully. Channel: ${conversation}, ts: ${(result as any).ts}`,
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
                (msg) =>
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

  async run(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('Slack MCP server running on stdio');
  }
}

// Run the server
const server = new SlackMCPServer();
server.run().catch(console.error);
