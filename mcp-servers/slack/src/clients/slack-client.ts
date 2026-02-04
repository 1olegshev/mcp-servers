/**
 * Slack Client Wrapper
 * Provides a clean interface for Slack API operations
 */

import { WebClient, ConversationsHistoryResponse, ConversationsListResponse } from '@slack/web-api';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { SlackAuth } from '../auth/slack-auth.js';
import { SlackResolver } from '../utils/resolvers.js';
import { Channel, SlackMessage } from '../types/index.js';

export class SlackClient {
  private slack: WebClient;
  private resolver: SlackResolver;

  constructor() {
    this.slack = SlackAuth.getInstance().getClient();
    this.resolver = new SlackResolver(this.slack);
  }

  async resolveConversation(target: string): Promise<string> {
    return this.resolver.resolveConversation(target);
  }

  async buildUserMap(): Promise<Record<string, { display: string }>> {
    return this.resolver.buildUserMap();
  }

  async sendMessage(channel: string, text: string, threadTs?: string): Promise<any> {
    try {
      const conversation = await this.resolveConversation(channel);
      return await this.slack.chat.postMessage({
        channel: conversation,
        text,
        thread_ts: threadTs,
        unfurl_links: false,
        unfurl_media: false,
      });
    } catch (error: any) {
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to send message: ${error.data?.error || error.message}`
      );
    }
  }

  async listChannels(types = 'public_channel,private_channel'): Promise<Channel[]> {
    try {
      let cursor: string | undefined;
      const channels: Channel[] = [];
      
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

      return channels;
    } catch (error: any) {
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to list channels: ${error.data?.error || error.message}`
      );
    }
  }

  async getChannelHistory(channel: string, limit = 10): Promise<SlackMessage[]> {
    try {
      const conversation = await this.resolveConversation(channel);
      const result = (await this.slack.conversations.history({
        channel: conversation,
        limit,
      })) as ConversationsHistoryResponse;

      return (result.messages || []) as SlackMessage[];
    } catch (error: any) {
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to get channel history: ${error.data?.error || error.message}`
      );
    }
  }

  async getChannelHistoryForDateRange(channel: string, oldest: string, latest: string, limit = 200): Promise<SlackMessage[]> {
    try {
      const conversation = await this.resolveConversation(channel);
      const result = await this.slack.conversations.history({
        channel: conversation,
        oldest,
        latest,
        inclusive: true,
        limit,
      });

      return (result.messages || []) as SlackMessage[];
    } catch (error: any) {
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to get channel history for date range: ${error.data?.error || error.message}`
      );
    }
  }

  async getThreadReplies(channel: string, threadTs: string): Promise<SlackMessage[]> {
    try {
      const conversation = await this.resolveConversation(channel);
      const all: any[] = [];
      let cursor: string | undefined;
      do {
        const result: any = await this.slack.conversations.replies({
          channel: conversation,
          ts: threadTs,
          limit: 200,
          cursor,
        } as any);
        const msgs = (result.messages || []) as any[];
        // Skip parent (first page includes parent as first message)
        const sliceFrom = all.length === 0 ? 1 : 0;
        all.push(...msgs.slice(sliceFrom));
        cursor = result.response_metadata?.next_cursor || undefined;
      } while (cursor);

      return all as SlackMessage[];
    } catch (error: any) {
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to get thread replies: ${error.data?.error || error.message}`
      );
    }
  }

  async searchMessages(query: string, channel?: string): Promise<any[]> {
    try {
      let q = query;
      
      // If channel is provided and not already in query, add it
      if (channel && !q.includes('in:')) {
        const chName = channel.startsWith('#') ? channel.slice(1) : channel;
        q = `${q} in:${chName}`;
      }

      const result = (await this.slack.search.messages({ 
        query: q, 
        sort: 'timestamp', // Sort by time for issue detection
        sort_dir: 'desc',
        count: 50 // Slightly higher to improve hit rate
      } as any)) as any;
      
      return (result.messages?.matches || []) as any[];
    } catch (error: any) {
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to search messages: ${error.data?.error || error.message}`
      );
    }
  }

  async addReaction(channel: string, timestamp: string, name: string): Promise<void> {
    try {
      const conversation = await this.resolveConversation(channel);
      await this.slack.reactions.add({
        channel: conversation,
        timestamp,
        name,
      });
    } catch (error: any) {
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to add reaction: ${error.data?.error || error.message}`
      );
    }
  }

  async getMessageDetails(channel: string, timestamp: string): Promise<any> {
    try {
      const conversation = await this.resolveConversation(channel);
      
      // Use conversations.history with inclusive parameter to get specific message
      const result = await this.slack.conversations.history({
        channel: conversation,
        latest: timestamp,
        oldest: timestamp,
        inclusive: true,
        limit: 1
      });

      if (!result.messages || result.messages.length === 0) {
        throw new McpError(
          ErrorCode.InternalError,
          `Message not found with timestamp ${timestamp} in channel ${channel}`
        );
      }

      // Return the complete message object including blocks, attachments, etc.
      return result.messages[0];
    } catch (error: any) {
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to get message details: ${error.data?.error || error.message}`
      );
    }
  }

  async getPermalink(channel: string, timestamp: string): Promise<string | undefined> {
    try {
      const conversation = await this.resolveConversation(channel);
      const res = await this.slack.chat.getPermalink({ channel: conversation, message_ts: timestamp } as any);
      return (res as any).permalink as string | undefined;
    } catch (error: any) {
      // Non-fatal; return undefined if we can't resolve the permalink
      return undefined;
    }
  }
}