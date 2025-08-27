/**
 * Messaging Operations Handler
 * Handles send_message, list_channels, get_channel_history, search_messages, add_reaction, get_thread_replies
 */

import { BaseHandler } from './base-handler.js';
import { SlackClient } from '../clients/slack-client.js';
import { SlackAuth } from '../auth/slack-auth.js';
import { ToolArgs, FormattedMessage } from '../types/index.js';
import { DateUtils } from '../utils/date-utils.js';
import { extractAllMessageText, isBotMessage, parseTestResultsFromText } from '../utils/message-extractor.js';

export class MessagingHandler extends BaseHandler {
  constructor(private slackClient: SlackClient) {
    super();
  }

  async sendMessage(args: ToolArgs) {
    this.validateRequired(args, ['channel', 'text']);
    
    // Validate write access to restricted channels
    SlackAuth.getInstance().validateWriteAccess(args.channel!);
    
    try {
      const result = await this.slackClient.sendMessage(
        args.channel!, 
        args.text!, 
        args.thread_ts
      );
      
      return this.formatResponse(
        `Message sent successfully. Channel: ${args.channel}, ts: ${result.ts}`
      );
    } catch (error) {
      this.handleError(error, 'send message');
    }
  }

  async listChannels(args: ToolArgs) {
    try {
      const channels = await this.slackClient.listChannels(args.types);
      
      const channelList = channels
        .map(ch => `• ${ch.name} (${ch.id}) - ${ch.topic || ch.purpose || 'No description'}`)
        .join('\n');
      
      return this.formatResponse(
        `Found ${channels.length} conversations:\n${channelList}`
      );
    } catch (error) {
      this.handleError(error, 'list channels');
    }
  }

  async getChannelHistory(args: ToolArgs) {
    this.validateRequired(args, ['channel']);
    
    try {
      const messages = await this.slackClient.getChannelHistory(
        args.channel!, 
        args.limit
      );

      let userMap: Record<string, { display: string }> = {};
      if (args.resolve_users) {
        userMap = await this.slackClient.buildUserMap();
      }

      const formattedMessages = messages.map(msg => ({
        user: args.resolve_users ? userMap[msg.user!]?.display || msg.user : msg.user,
        text: msg.text,
        timestamp: msg.ts,
        thread_ts: msg.thread_ts,
      }));

      const messageList = formattedMessages
        .map(msg => 
          `[${DateUtils.formatTimestamp(msg.timestamp!)}] ${msg.user}: ${msg.text}`
        )
        .join('\n');

      return this.formatResponse(
        `Last ${formattedMessages.length} messages from ${args.channel}:\n${messageList}`
      );
    } catch (error) {
      this.handleError(error, 'get channel history');
    }
  }

  async searchMessages(args: ToolArgs) {
    this.validateRequired(args, ['query']);
    
    try {
      const matches = await this.slackClient.searchMessages(args.query!, args.channel);
      
      const formattedMatches = matches.map((match: any) => ({
        channel: match.channel?.name || match.channel?.id,
        user: match.user,
        text: match.text,
        timestamp: match.ts,
      }));

      const matchList = formattedMatches
        .slice(0, 10)
        .map(m => `[${m.channel}] ${m.user}: ${m.text}`)
        .join('\n');

      return this.formatResponse(
        `Found ${formattedMatches.length} matching messages:\n${matchList}${
          formattedMatches.length > 10 ? '\n... and more' : ''
        }`
      );
    } catch (error) {
      this.handleError(error, 'search messages');
    }
  }

  async addReaction(args: ToolArgs) {
    this.validateRequired(args, ['channel', 'timestamp', 'name']);
    
    try {
      await this.slackClient.addReaction(args.channel!, args.timestamp!, args.name!);
      
      return this.formatResponse(
        `Added :${args.name}: to ${args.channel} at ${args.timestamp}`
      );
    } catch (error) {
      this.handleError(error, 'add reaction');
    }
  }

  async getThreadReplies(args: ToolArgs) {
    this.validateRequired(args, ['channel', 'thread_ts']);
    
    try {
      const replies = await this.slackClient.getThreadReplies(
        args.channel!, 
        args.thread_ts!
      );

      const replyList = replies
        .map(reply => 
          `[${DateUtils.formatTimestamp(reply.ts!)}] ${reply.user}: ${reply.text}`
        )
        .join('\n');

      return this.formatResponse(
        `Found ${replies.length} replies in thread:\n${replyList}`
      );
    } catch (error) {
      this.handleError(error, 'get thread replies');
    }
  }

  async getMessageDetails(args: ToolArgs) {
    this.validateRequired(args, ['channel', 'timestamp']);
    
    try {
      const messageDetails = await this.slackClient.getMessageDetails(
        args.channel!, 
        args.timestamp!
      );

      // Return the raw JSON structure for analysis
      return {
        content: [{
          type: 'text',
          text: `Message details for ${args.channel} at ${args.timestamp}:\n\n` +
                `\`\`\`json\n${JSON.stringify(messageDetails, null, 2)}\n\`\`\``
        }]
      };
    } catch (error) {
      this.handleError(error, 'get message details');
    }
  }

  async findBotMessages(args: ToolArgs) {
    const channel = args.channel || 'functional-testing';
    const limit = args.limit || 100;
    
    try {
      const messages = await this.slackClient.getChannelHistory(channel, limit);
      
      const botMessages: any[] = [];
      
      for (const message of messages) {
        // Check if this is a bot message
        if (isBotMessage(message)) {
          // Extract all text from the message
          const extractedText = extractAllMessageText(message);
          
          // Parse any test results
          const parsedResults = parseTestResultsFromText(extractedText.text);
          
          // Build bot message info
          const botInfo = {
            timestamp: message.ts,
            user: message.user || 'no user',
            bot_id: (message as any).bot_id || 'no bot_id',
            subtype: (message as any).subtype || 'no subtype',
            username: (message as any).username || 'no username',
            originalText: message.text || 'no text',
            extractedText: extractedText.text,
            hasBlocks: extractedText.hasBlocks,
            hasAttachments: extractedText.hasAttachments,
            extractedFromBlocks: extractedText.extractedFromBlocks,
            extractedFromAttachments: extractedText.extractedFromAttachments,
            parsedTestResults: parsedResults,
            formatted_time: DateUtils.formatTimestamp(message.ts!)
          };
          
          botMessages.push(botInfo);
        }
      }
      
      // Sort by timestamp (newest first)
      botMessages.sort((a, b) => parseFloat(b.timestamp) - parseFloat(a.timestamp));
      
      let output = `🤖 Found ${botMessages.length} bot messages in ${channel}:\n\n`;
      
      for (const bot of botMessages.slice(0, 10)) { // Show top 10
        output += `**[${bot.formatted_time}]** (${bot.timestamp})\n`;
        output += `• User: ${bot.user}\n`;
        output += `• Bot ID: ${bot.bot_id}\n`;
        output += `• Username: ${bot.username}\n`;
        output += `• Original: "${bot.originalText}"\n`;
        
        if (bot.extractedText !== bot.originalText) {
          output += `• Extracted: "${bot.extractedText}"\n`;
        }
        
        if (bot.hasBlocks) {
          output += `• Has Blocks: YES (${bot.extractedFromBlocks ? 'extracted content' : 'no content'})\n`;
        }
        
        if (bot.hasAttachments) {
          output += `• Has Attachments: YES (${bot.extractedFromAttachments ? 'extracted content' : 'no content'})\n`;
        }
        
        if (bot.parsedTestResults.testType) {
          output += `• Test Type: ${bot.parsedTestResults.testType}\n`;
          output += `• Status: ${bot.parsedTestResults.status || 'unknown'}\n`;
          if (bot.parsedTestResults.runNumber) {
            output += `• Run Number: #${bot.parsedTestResults.runNumber}\n`;
          }
          if (bot.parsedTestResults.failedTests.length > 0) {
            output += `• Failed Tests: ${bot.parsedTestResults.failedTests.join(', ')}\n`;
          }
        }
        
        output += `\n`;
      }
      
      if (botMessages.length > 10) {
        output += `... and ${botMessages.length - 10} more bot messages\n\n`;
      }
      
      // Suggest testing with the first bot message
      if (botMessages.length > 0) {
        output += `🔍 To examine full JSON structure of first bot message, use:\n`;
        output += `\`get_message_details\` with timestamp: \`${botMessages[0].timestamp}\`\n`;
      }
      
      return this.formatResponse(output);
    } catch (error) {
      this.handleError(error, 'find bot messages');
    }
  }
}