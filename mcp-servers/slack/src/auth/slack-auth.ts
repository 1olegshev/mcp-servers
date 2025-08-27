/**
 * Slack Authentication Handler
 * Manages XOXC/XOXD session-based authentication
 */

import { WebClient } from '@slack/web-api';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { createXOXCWebClient } from '../simple-xoxc.js';

export class SlackAuth {
  private static instance: SlackAuth;
  private client: WebClient | null = null;

  private constructor() {}

  static getInstance(): SlackAuth {
    if (!SlackAuth.instance) {
      SlackAuth.instance = new SlackAuth();
    }
    return SlackAuth.instance;
  }

  /**
   * Initialize Slack WebClient with session-based authentication
   * Priority: XOXC/XOXD session tokens > Legacy bot token
   */
  initializeClient(): WebClient {
    if (this.client) {
      return this.client;
    }

    const xoxc = process.env.SLACK_MCP_XOXC_TOKEN;
    const xoxd = process.env.SLACK_MCP_XOXD_TOKEN;
    const legacyBot = process.env.SLACK_BOT_TOKEN;
    
    if (xoxc) {
      this.client = createXOXCWebClient(xoxc, xoxd);
      return this.client;
    }

    if (legacyBot) {
      this.client = new WebClient(legacyBot);
      return this.client;
    }

    throw new McpError(
      ErrorCode.InvalidRequest,
      'Missing Slack authentication. Provide SLACK_MCP_XOXC_TOKEN (+ SLACK_MCP_XOXD_TOKEN) for session auth, or SLACK_BOT_TOKEN for bot auth.'
    );
  }

  getClient(): WebClient {
    if (!this.client) {
      return this.initializeClient();
    }
    return this.client;
  }

  /**
   * Validates if posting to a channel is allowed
   * Business requirement: Only qa-release-status channel for writes
   */
  validateWriteAccess(channel: string): void {
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
  }
}