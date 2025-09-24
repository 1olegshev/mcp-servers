/**
 * IssueDetectionPipeline Integration Tests
 * Tests the complete pipeline orchestration
 */

import { IssueDetectionPipeline } from '../pipeline/issue-detection.pipeline';
import { SlackMessageService } from '../services/slack-message.service';
import { BlockerPatternService } from '../services/blocker-pattern.service';
import { ContextAnalyzerService } from '../services/context-analyzer.service';
import { SmartDeduplicatorService } from '../services/smart-deduplicator.service';

// Mock the SlackClient
const mockSlackClient = {
  searchMessages: jest.fn(),
  getMessageDetails: jest.fn(),
  getThreadReplies: jest.fn(),
  getPermalink: jest.fn(),
  resolveConversation: jest.fn()
};

describe('IssueDetectionPipeline', () => {
  let pipeline: IssueDetectionPipeline;
  let messageService: SlackMessageService;
  let patternService: BlockerPatternService;
  let contextService: ContextAnalyzerService;
  let deduplicatorService: SmartDeduplicatorService;

  beforeEach(() => {
    jest.clearAllMocks();

    mockSlackClient.searchMessages.mockReset();
    mockSlackClient.getMessageDetails.mockReset();
    mockSlackClient.getThreadReplies.mockReset();
    mockSlackClient.getPermalink.mockReset();
    mockSlackClient.resolveConversation.mockReset();

    messageService = new SlackMessageService(mockSlackClient as any);
    patternService = new BlockerPatternService();
    contextService = new ContextAnalyzerService(mockSlackClient as any);
    deduplicatorService = new SmartDeduplicatorService();

    pipeline = new IssueDetectionPipeline(
      messageService,
      patternService,
      contextService,
      deduplicatorService
    );
  });

  describe('detectIssues', () => {
    it('should process empty results gracefully', async () => {
      // Mock empty search results
      mockSlackClient.searchMessages.mockResolvedValue([]);

      const result = await pipeline.detectIssues('test-channel', '2025-01-01');

      expect(result).toEqual([]);
      expect(mockSlackClient.searchMessages).toHaveBeenCalledTimes(7); // 7 search queries
    });

    it('should handle Slack API errors gracefully', async () => {
      mockSlackClient.searchMessages.mockRejectedValue(new Error('API Error'));

      await expect(pipeline.detectIssues('test-channel', '2025-01-01')).rejects.toThrow('Issue detection pipeline failed: All Slack API searches failed');
    });

    it('should process blocking issues through the pipeline', async () => {
      const mockMessages = [
        {
          ts: '1234567890',
          text: 'PROJ-123 is a release blocker',
          thread_ts: undefined
        }
      ];

      // Mock the search to return our test message
      mockSlackClient.searchMessages.mockResolvedValue(mockMessages);
      mockSlackClient.getMessageDetails.mockResolvedValue(mockMessages[0]);
      mockSlackClient.getThreadReplies.mockResolvedValue([]);
      mockSlackClient.getPermalink.mockResolvedValue('https://slack.com/thread');

      const result = await pipeline.detectIssues('test-channel', '2025-01-01');

      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('blocking');
      expect(result[0].tickets[0].key).toBe('PROJ-123');
    });

    it('should keep list-only hotfix blockers even when fix is ready', async () => {
      const listMessage = {
        ts: '1234567890',
        text: 'We will hotfix PROJ-456 (fix ready)'
      };

      mockSlackClient.searchMessages.mockResolvedValue([listMessage]);
      mockSlackClient.getMessageDetails.mockResolvedValue(listMessage);
      mockSlackClient.getThreadReplies.mockResolvedValue([]);
      mockSlackClient.getPermalink.mockResolvedValue(undefined);

      const result = await pipeline.detectIssues('test-channel', '2025-01-01');

      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('blocking');
      expect(result[0].tickets[0].key).toBe('PROJ-456');
      expect(result[0].permalink).toBeUndefined();
    });

    it('should deduplicate issues with same ticket', async () => {
      const mockMessages = [
        {
          ts: '1234567890',
          text: 'PROJ-123 is blocking',
          thread_ts: undefined
        },
        {
          ts: '1234567891',
          text: 'Also PROJ-123 blocks release',
          thread_ts: undefined
        }
      ];

      mockSlackClient.searchMessages.mockResolvedValue(mockMessages);
      mockSlackClient.getMessageDetails.mockImplementation((channel, ts) =>
        Promise.resolve(mockMessages.find(m => m.ts === ts))
      );
      mockSlackClient.getThreadReplies.mockResolvedValue([]);
      mockSlackClient.getPermalink.mockResolvedValue('https://slack.com/thread');

      const result = await pipeline.detectIssues('test-channel', '2025-01-01');

      // Should be deduplicated to one issue
      expect(result).toHaveLength(1);
      expect(result[0].tickets[0].key).toBe('PROJ-123');
    });
  });

  describe('pipeline validation', () => {
    it('should validate pipeline configuration', () => {
      const validation = pipeline.validatePipeline();

      expect(validation.isValid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });

    it('should detect missing services', () => {
      const invalidPipeline = new IssueDetectionPipeline(
        null as any, // Missing message service
        patternService,
        contextService,
        deduplicatorService
      );

      const validation = invalidPipeline.validatePipeline();

      expect(validation.isValid).toBe(false);
      expect(validation.errors).toContain('SlackMessageService is not configured');
    });
  });

  describe('error handling', () => {
    it('should handle partial failures in search queries', async () => {
      // Some searches succeed, some fail
      mockSlackClient.searchMessages
        .mockResolvedValueOnce([{ ts: '123', text: 'blocker PROJ-456' }]) // Success
        .mockRejectedValueOnce(new Error('Search failed'))       // Failure
        .mockResolvedValue([]); // Rest succeed with empty results

      const result = await pipeline.detectIssues('test-channel', '2025-01-01');

      // Should still process successful searches
      expect(result.length).toBeGreaterThan(0);
    });

    it('should handle thread context failures', async () => {
      const mockMessages = [{
        ts: '1234567890',
        text: 'PROJ-123 blocker',
        thread_ts: undefined
      }];

      mockSlackClient.searchMessages.mockResolvedValue(mockMessages);
      mockSlackClient.getMessageDetails.mockRejectedValue(new Error('Thread fetch failed'));
      mockSlackClient.getThreadReplies.mockRejectedValue(new Error('Thread fetch failed'));

      // Should still return basic issue without thread context
      const result = await pipeline.detectIssues('test-channel', '2025-01-01');

      expect(result).toHaveLength(1);
      expect(result[0].hasThread).toBe(false);
    });
  });

  describe('performance and resource usage', () => {
    it('should handle large message sets efficiently', async () => {
      const largeMessageSet = Array.from({ length: 100 }, (_, i) => ({
        ts: `123456789${i}`,
        text: `PROJ-${i} is blocking`,
        thread_ts: undefined
      }));

      mockSlackClient.searchMessages.mockResolvedValue(largeMessageSet);
      mockSlackClient.getMessageDetails.mockImplementation((channel, ts) =>
        Promise.resolve(largeMessageSet.find(m => m.ts === ts))
      );
      mockSlackClient.getThreadReplies.mockResolvedValue([]);
      mockSlackClient.getPermalink.mockResolvedValue('https://slack.com/thread');

      const startTime = Date.now();
      const result = await pipeline.detectIssues('test-channel', '2025-01-01');
      const duration = Date.now() - startTime;

      expect(result.length).toBeGreaterThan(0);
      expect(duration).toBeLessThan(5000); // Should complete within 5 seconds
    });
  });
});
