/**
 * Channel and User Resolution Utilities
 */

import { WebClient, ConversationsListResponse, UsersListResponse } from '@slack/web-api';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { UserInfo } from '../types/index.js';

export class SlackResolver {
  private userCache = new Map<string, UserInfo>();
  private channelCache = new Map<string, string>(); // name -> id mapping

  constructor(private slack: WebClient) {}

  /**
   * Resolve various channel/user notations to a conversation ID
   * Supports: channel IDs, user IDs, @username, #channel-name
   */
  async resolveConversation(target: string): Promise<string> {
    if (!target || typeof target !== 'string') {
      throw new McpError(ErrorCode.InvalidParams, 'channel is required');
    }

    const t = target.trim();
    
    // Already a conversation ID
    if (/^[CGD][A-Z0-9]+$/.test(t)) {
      return t;
    }

    // User ID for DM
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
    // Check cache first
    if (this.channelCache.has(name)) {
      return this.channelCache.get(name)!;
    }

    let cursor: string | undefined;
    do {
      const res = (await this.slack.conversations.list({
        exclude_archived: true,
        limit: 1000,
        types: 'public_channel,private_channel,im,mpim',
        cursor,
      })) as ConversationsListResponse & { response_metadata?: { next_cursor?: string } };
      
      for (const ch of (res.channels || []) as any[]) {
        // Cache all channels we encounter
        this.channelCache.set(ch.name, ch.id);
        if (ch.name === name) return ch.id as string;
      }
      cursor = res.response_metadata?.next_cursor || undefined;
    } while (cursor);
    return null;
  }

  private async findUserByHandle(handle: string): Promise<UserInfo | null> {
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
          return user as UserInfo;
        }
      }
      cursor = res.response_metadata?.next_cursor || undefined;
    } while (cursor);
    return null;
  }

  async buildUserMap(): Promise<Record<string, { display: string }>> {
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
}