#!/usr/bin/env node

/**
 * Slack MCP Server for Release Management and QA Coordination
 * Clean, modular architecture with proper separation of concerns
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ErrorCode, McpError, CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Import our clean modular services
import { SlackAuth } from './auth/slack-auth.js';
import { SlackClient } from './clients/slack-client.js';
import { IssueDetectorService } from './services/issue-detector.js';
import { TestAnalyzerService } from './services/test-analyzer.js';
import { ReleaseAnalyzerService } from './services/release-analyzer.js';
import { MessagingHandler } from './handlers/messaging.js';
import { AnalysisHandler } from './handlers/analysis.js';
import { ToolArgs } from './types/index.js';

// Load environment variables
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.resolve(__dirname, '../../../.env');
dotenv.config({ path: envPath });

export class SlackMCPServer {
  private server: Server;
  private messagingHandler!: MessagingHandler;
  private analysisHandler!: AnalysisHandler;

  constructor() {
    this.server = new Server(
      {
        name: 'slack-mcp-server',
        version: '2.0.0',
      },
      {
        capabilities: { tools: {} },
      }
    );

    this.initializeServices();
    this.setupHandlers();
  }

  private initializeServices(): void {
    // Initialize authentication
    SlackAuth.getInstance().initializeClient();
    
    // Initialize client and services
    const slackClient = new SlackClient();
    const issueDetector = new IssueDetectorService(slackClient);
    const testAnalyzer = new TestAnalyzerService(slackClient);
    const releaseAnalyzer = new ReleaseAnalyzerService(issueDetector, testAnalyzer);
    
    // Initialize handlers
    this.messagingHandler = new MessagingHandler(slackClient);
    this.analysisHandler = new AnalysisHandler(issueDetector, testAnalyzer, releaseAnalyzer);
  }

  private setupHandlers(): void {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'send_message',
          description: 'Send a message to a Slack channel',
          inputSchema: {
            type: 'object',
            properties: {
              channel: { type: 'string', description: 'Target channel or user. Accepts: channel ID (C123..), #channel-name, @username, U123.. user ID' },
              text: { type: 'string', description: 'Message text to send' },
              thread_ts: { type: 'string', description: 'Optional: Thread timestamp to reply to' },
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
              types: { type: 'string', description: 'Channel types to include (public_channel,private_channel,im,mpim)', default: 'public_channel,private_channel' },
            },
          },
        },
        {
          name: 'get_channel_history',
          description: 'Get recent messages from a channel',
          inputSchema: {
            type: 'object',
            properties: {
              channel: { type: 'string', description: 'Channel ID or #channel-name or DM target (@user or U123). Will be resolved to a conversation ID.' },
              limit: { type: 'number', description: 'Number of messages to retrieve', default: 10 },
              resolve_users: { type: 'boolean', description: 'If true, resolves user IDs to display names', default: false },
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
              query: { type: 'string', description: 'Search query' },
              channel: { type: 'string', description: 'Optional: Channel name to restrict search (e.g., #general). Note: Slack search requires channel name, not ID.' },
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
              channel: { type: 'string', description: 'Channel ID or #channel-name of the message. DMs also supported (@user or U123).' },
              timestamp: { type: 'string', description: 'The message timestamp (ts) to react to' },
              name: { type: 'string', description: 'Emoji name without colons (e.g., thumbsup)' },
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
              channel: { type: 'string', description: 'Channel ID or #channel-name' },
              thread_ts: { type: 'string', description: 'Thread timestamp to get replies from' },
              limit: { type: 'number', description: 'Number of replies to retrieve', default: 50 },
            },
            required: ['channel', 'thread_ts'],
          },
        },
        {
          name: 'get_message_details',
          description: 'Get complete message details including blocks and attachments (for bot message analysis)',
          inputSchema: {
            type: 'object',
            properties: {
              channel: { type: 'string', description: 'Channel ID or #channel-name' },
              timestamp: { type: 'string', description: 'Message timestamp to get details for' },
            },
            required: ['channel', 'timestamp'],
          },
        },
        {
          name: 'find_bot_messages',
          description: 'Find and analyze bot messages with their complete structure',
          inputSchema: {
            type: 'object',
            properties: {
              channel: { type: 'string', description: 'Channel ID or #channel-name', default: 'functional-testing' },
              limit: { type: 'number', description: 'Number of messages to search through', default: 100 },
            },
          },
        },
        {
          name: 'get_blocking_issues',
          description: 'Find blocking or critical issues in channel for a specific date',
          inputSchema: {
            type: 'object',
            properties: {
              channel: { type: 'string', description: 'Channel to analyze (defaults to functional-testing)', default: 'functional-testing' },
              date: { type: 'string', description: 'Date to analyze (YYYY-MM-DD format, defaults to today)' },
              severity: { type: 'string', description: 'Issue severity to find', enum: ['blocking', 'critical', 'both'], default: 'both' },
            },
          },
        },
        {
          name: 'get_auto_test_status',
          description: 'Analyze auto test results and their review status for a specific date',
          inputSchema: {
            type: 'object',
            properties: {
              channel: { type: 'string', description: 'Channel to analyze (defaults to functional-testing)', default: 'functional-testing' },
              date: { type: 'string', description: 'Date to analyze (YYYY-MM-DD format, defaults to today)' },
            },
          },
        },
        {
          name: 'get_release_status_overview',
          description: 'Get comprehensive release status overview - answers "Can we release today?"',
          inputSchema: {
            type: 'object',
            properties: {
              channel: { type: 'string', description: 'Channel to analyze (defaults to functional-testing)', default: 'functional-testing' },
              date: { type: 'string', description: 'Date to analyze (YYYY-MM-DD format, defaults to today)' },
            },
          },
        },
      ],
    }));

    // Handle tool calls - delegate to appropriate handlers
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      try {
        const { name, arguments: args } = request.params as any;
        const toolArgs = args as ToolArgs;

        switch (name) {
          // Messaging operations
          case 'send_message':
            return await this.messagingHandler.sendMessage(toolArgs);
          case 'list_channels':
            return await this.messagingHandler.listChannels(toolArgs);
          case 'get_channel_history':
            return await this.messagingHandler.getChannelHistory(toolArgs);
          case 'search_messages':
            return await this.messagingHandler.searchMessages(toolArgs);
          case 'add_reaction':
            return await this.messagingHandler.addReaction(toolArgs);
          case 'get_thread_replies':
            return await this.messagingHandler.getThreadReplies(toolArgs);
          case 'get_message_details':
            return await this.messagingHandler.getMessageDetails(toolArgs);
          case 'find_bot_messages':
            return await this.messagingHandler.findBotMessages(toolArgs);
          
          // Analysis operations
          case 'get_blocking_issues':
            return await this.analysisHandler.getBlockingIssues(toolArgs);
          case 'get_auto_test_status':
            return await this.analysisHandler.getAutoTestStatus(toolArgs);
          case 'get_release_status_overview':
            return await this.analysisHandler.getReleaseStatusOverview(toolArgs);
          
          default:
            throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
        }
      } catch (error: any) {
        if (error instanceof McpError) {
          throw error;
        }
        throw new McpError(ErrorCode.InternalError, `Error calling tool: ${error.message}`);
      }
    });
  }

  async run(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('Slack MCP server v2.0 running on stdio');
  }
}

// Run the server
const server = new SlackMCPServer();
server.run().catch(console.error);