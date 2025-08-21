#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { WebClient } from '@slack/web-api';
import { CallToolRequestSchema, ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import dotenv from 'dotenv';

// Load environment variables from parent directory
dotenv.config({ path: '../../.env' });

class SlackMCPServer {
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

    this.slack = null;
    this.initializeSlack();
    this.setupHandlers();
  }

  initializeSlack() {
    const token = process.env.SLACK_BOT_TOKEN;
    if (!token) {
      throw new Error('SLACK_BOT_TOKEN environment variable is required');
    }

    this.slack = new WebClient(token);
  }

  setupHandlers() {
    // List available tools
    this.server.setRequestHandler('tools/list', async () => {
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
                  description: 'Channel ID or name (e.g., #general or C1234567890)',
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
                  description: 'Channel types to include (public_channel,private_channel,im,mpim)',
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
                  description: 'Channel ID or name',
                },
                limit: {
                  type: 'number',
                  description: 'Number of messages to retrieve',
                  default: 10,
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
                  description: 'Optional: Channel to search in',
                },
              },
              required: ['query'],
            },
          },
        ],
      };
    });

    // Handle tool calls
    this.server.setRequestHandler('tools/call', async (request) => {
      try {
        const { name, arguments: args } = request.params;

        switch (name) {
          case 'send_message':
            return await this.sendMessage(args);
          case 'list_channels':
            return await this.listChannels(args);
          case 'get_channel_history':
            return await this.getChannelHistory(args);
          case 'search_messages':
            return await this.searchMessages(args);
          default:
            throw new McpError(
              ErrorCode.MethodNotFound,
              `Unknown tool: ${name}`
            );
        }
      } catch (error) {
        throw new McpError(
          ErrorCode.InternalError,
          `Error calling tool: ${error.message}`
        );
      }
    });
  }

  async sendMessage(args) {
    const { channel, text, thread_ts } = args;

    try {
      const result = await this.slack.chat.postMessage({
        channel,
        text,
        thread_ts,
      });

      return {
        content: [
          {
            type: 'text',
            text: `Message sent successfully to ${channel}. Message timestamp: ${result.ts}`,
          },
        ],
      };
    } catch (error) {
      throw new Error(`Failed to send message: ${error.message}`);
    }
  }

  async listChannels(args) {
    const { types = 'public_channel,private_channel' } = args;

    try {
      const result = await this.slack.conversations.list({
        types,
      });

      const channels = result.channels.map((ch) => ({
        id: ch.id,
        name: ch.name,
        topic: ch.topic?.value || '',
        purpose: ch.purpose?.value || '',
        num_members: ch.num_members,
      }));

      return {
        content: [
          {
            type: 'text',
            text: `Found ${channels.length} channels:\n${channels
              .map((ch) => `• ${ch.name} (${ch.id}) - ${ch.topic || ch.purpose || 'No description'}`)
              .join('\n')}`,
          },
        ],
      };
    } catch (error) {
      throw new Error(`Failed to list channels: ${error.message}`);
    }
  }

  async getChannelHistory(args) {
    const { channel, limit = 10 } = args;

    try {
      const result = await this.slack.conversations.history({
        channel,
        limit,
      });

      const messages = result.messages.map((msg) => ({
        user: msg.user,
        text: msg.text,
        timestamp: msg.ts,
        thread_ts: msg.thread_ts,
      }));

      return {
        content: [
          {
            type: 'text',
            text: `Last ${messages.length} messages from ${channel}:\n${messages
              .map((msg) => `[${new Date(parseFloat(msg.timestamp) * 1000).toLocaleString()}] ${msg.user}: ${msg.text}`)
              .join('\n')}`,
          },
        ],
      };
    } catch (error) {
      throw new Error(`Failed to get channel history: ${error.message}`);
    }
  }

  async searchMessages(args) {
    const { query, channel } = args;

    try {
      const result = await this.slack.search.messages({
        query,
        ...(channel && { in: channel }),
      });

      const matches = result.messages.matches.map((match) => ({
        channel: match.channel.name,
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
              .map((match) => `[${match.channel}] ${match.user}: ${match.text}`)
              .join('\n')}${matches.length > 10 ? '\n... and more' : ''}`,
          },
        ],
      };
    } catch (error) {
      throw new Error(`Failed to search messages: ${error.message}`);
    }
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('Slack MCP server running on stdio');
  }
}

// Run the server
const server = new SlackMCPServer();
server.run().catch(console.error);
