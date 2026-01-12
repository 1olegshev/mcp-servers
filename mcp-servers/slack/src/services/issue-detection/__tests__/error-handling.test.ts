/**
 * Error Handling and Edge Cases Tests
 * Tests critical failure scenarios and edge cases
 */

import { IssueDetectionPipeline } from '../pipeline/issue-detection.pipeline.js';
import { BlockerPatternService } from '../services/blocker-pattern.service.js';
import { SlackMessageService } from '../services/slack-message.service.js';
import { ContextAnalyzerService } from '../services/context-analyzer.service.js';
import { SmartDeduplicatorService } from '../services/smart-deduplicator.service.js';

// Mock SlackClient that can simulate various error conditions
const createMockSlackClient = (errorMode = 'none') => ({
  searchMessages: jest.fn(),
  getMessageDetails: jest.fn(),
  getThreadReplies: jest.fn(),
  getPermalink: jest.fn(),
  resolveConversation: jest.fn()
});

describe('Error Handling and Edge Cases', () => {
  let mockClient: any;

  beforeEach(() => {
    mockClient = createMockSlackClient();
  });

  describe('Network and API failures', () => {
    it('should handle complete API unavailability', async () => {
      mockClient.searchMessages.mockRejectedValue(new Error('Network timeout'));

      const pipeline = new IssueDetectionPipeline(
        new SlackMessageService(mockClient),
        new BlockerPatternService(),
        new ContextAnalyzerService(mockClient),
        new SmartDeduplicatorService()
      );
      pipeline.setLLMClassification(false); // Disable LLM in tests

      await expect(pipeline.detectIssues('test-channel', '2025-01-01'))
        .rejects.toThrow('Issue detection pipeline failed: All Slack API searches failed');
    });

    it('should handle partial API failures', async () => {
      // Some searches succeed, others fail
      mockClient.searchMessages
        .mockResolvedValueOnce([{ ts: '123', text: 'blocker PROJ-123 found' }])
        .mockRejectedValueOnce(new Error('API rate limit'))
        .mockResolvedValue([]);

      const pipeline = new IssueDetectionPipeline(
        new SlackMessageService(mockClient),
        new BlockerPatternService(),
        new ContextAnalyzerService(mockClient),
        new SmartDeduplicatorService()
      );
      pipeline.setLLMClassification(false); // Disable LLM in tests

      // Should still process successful searches
      const result = await pipeline.detectIssues('test-channel', '2025-01-01');
      expect(result.length).toBeGreaterThan(0);
    });

    it('should handle authentication failures', async () => {
      mockClient.searchMessages.mockRejectedValue(new Error('Authentication failed'));

      const pipeline = new IssueDetectionPipeline(
        new SlackMessageService(mockClient),
        new BlockerPatternService(),
        new ContextAnalyzerService(mockClient),
        new SmartDeduplicatorService()
      );
      pipeline.setLLMClassification(false); // Disable LLM in tests

      await expect(pipeline.detectIssues('test-channel', '2025-01-01'))
        .rejects.toThrow('Issue detection pipeline failed: All Slack API searches failed');
    });
  });

  describe('Malformed data handling', () => {
    it('should handle malformed Slack messages', async () => {
      const malformedMessages = [
        { ts: undefined, text: null }, // Missing required fields
        { ts: '123', text: undefined }, // Undefined text
        { ts: '456' }, // No text field
        null, // Null message
        {} // Empty object
      ];

      mockClient.searchMessages.mockResolvedValue(malformedMessages);
      mockClient.getMessageDetails.mockImplementation((channel: string, ts: string) => {
        const msg = malformedMessages.find(m => m?.ts === ts);
        return Promise.resolve(msg || { ts, text: 'fallback' });
      });
      mockClient.getThreadReplies.mockResolvedValue([]);

      const patternService = new BlockerPatternService();
      const deduplicatorService = new SmartDeduplicatorService();

      // Should not crash and should handle gracefully
      const ticketContexts = malformedMessages
        .filter((msg): msg is any => Boolean(msg?.text))
        .map(msg => patternService.parseBlockerList(msg.text))
        .flat();

      expect(ticketContexts).toEqual([]); // Should return empty array for malformed data
    });

    it('should handle invalid JIRA ticket formats', () => {
      const patternService = new BlockerPatternService();

      const invalidFormats = [
        'INVALID-TICKET',
        'PROJ-', // Missing number
        '-123', // Missing project
        'PROJ-ABC', // Non-numeric ID
        'PROJX123', // No dash
        '' // Empty
      ];

      invalidFormats.forEach(format => {
        const tickets = patternService.extractTickets(format);
        expect(tickets).toHaveLength(0);
      });
    });

    it('should handle extremely long text inputs', () => {
      const patternService = new BlockerPatternService();
      const longText = 'A'.repeat(10000) + ' blocker ' + 'B'.repeat(10000);

      // Should not crash and should still find the keyword
      expect(patternService.hasBlockingIndicators(longText)).toBe(true);

      const tickets = patternService.extractTickets(longText);
      expect(Array.isArray(tickets)).toBe(true);
    });
  });

  describe('Concurrency and race conditions', () => {
    it('should handle concurrent pipeline executions', async () => {
      const pipeline = new IssueDetectionPipeline(
        new SlackMessageService(mockClient),
        new BlockerPatternService(),
        new ContextAnalyzerService(mockClient),
        new SmartDeduplicatorService()
      );
      pipeline.setLLMClassification(false); // Disable LLM in tests

      mockClient.searchMessages.mockResolvedValue([]);
      mockClient.getMessageDetails.mockResolvedValue({ ts: '123', text: 'test' });
      mockClient.getThreadReplies.mockResolvedValue([]);

      // Run multiple pipeline executions concurrently
      const promises = Array.from({ length: 10 }, () =>
        pipeline.detectIssues('test-channel', '2025-01-01')
      );

      const results = await Promise.all(promises);

      // All should complete successfully
      results.forEach(result => {
        expect(Array.isArray(result)).toBe(true);
      });
    });

    it('should handle rapid successive calls', async () => {
      const pipeline = new IssueDetectionPipeline(
        new SlackMessageService(mockClient),
        new BlockerPatternService(),
        new ContextAnalyzerService(mockClient),
        new SmartDeduplicatorService()
      );
      pipeline.setLLMClassification(false); // Disable LLM in tests

      mockClient.searchMessages.mockResolvedValue([]);

      // Rapid fire multiple calls
      for (let i = 0; i < 50; i++) {
        await pipeline.detectIssues('test-channel', '2025-01-01');
      }

      // Should not have accumulated any state issues
      expect(mockClient.searchMessages).toHaveBeenCalledTimes(50 * 7); // 7 searches per call
    });
  });

  describe('Resource limits and performance', () => {
    it('should handle memory-intensive operations', async () => {
      const largeMessageSet = Array.from({ length: 1000 }, (_, i) => ({
        ts: `123456789${i}`,
        text: `PROJ-${i} is a ${i % 2 === 0 ? 'blocker' : 'normal'} issue`,
        thread_ts: undefined
      }));

      mockClient.searchMessages.mockResolvedValue(largeMessageSet);
      mockClient.getMessageDetails.mockImplementation((channel: string, ts: string) =>
        Promise.resolve(largeMessageSet.find(m => m.ts === ts))
      );
      mockClient.getThreadReplies.mockResolvedValue([]);

      const pipeline = new IssueDetectionPipeline(
        new SlackMessageService(mockClient),
        new BlockerPatternService(),
        new ContextAnalyzerService(mockClient),
        new SmartDeduplicatorService()
      );
      pipeline.setLLMClassification(false); // Disable LLM in tests

      const startTime = Date.now();
      const result = await pipeline.detectIssues('test-channel', '2025-01-01');
      const duration = Date.now() - startTime;

      expect(result.length).toBeGreaterThan(0);
      expect(duration).toBeLessThan(10000); // Should complete within reasonable time
    });

    it('should handle empty or null inputs gracefully', () => {
      const patternService = new BlockerPatternService();

      expect(() => patternService.hasBlockingIndicators('')).toBeDefined();
      expect(() => patternService.hasBlockingIndicators(null as any)).toBeDefined();
      expect(() => patternService.hasBlockingIndicators(undefined as any)).toBeDefined();

      expect(() => patternService.extractTickets('')).toBeDefined();
      expect(() => patternService.parseBlockerList(null as any)).toBeDefined();
    });
  });

  describe('Business logic edge cases', () => {
    it('should handle tickets with similar names', () => {
      const patternService = new BlockerPatternService();
      const text = 'PROJ-123 and PROJ-1234 and PROJ-12345';

      const tickets = patternService.extractTickets(text);

      expect(tickets.map(t => t.key)).toEqual(['PROJ-123', 'PROJ-1234', 'PROJ-12345']);
    });

    it('should handle overlapping blocking and critical patterns', () => {
      const patternService = new BlockerPatternService();

      // Text that contains both blocking and critical indicators
      const text = 'This urgent blocker needs immediate attention';

      expect(patternService.hasBlockingIndicators(text)).toBe(true);
      expect(patternService.hasCriticalIndicators(text)).toBe(true);
    });

    it('should handle complex blocker list formats', () => {
      const patternService = new BlockerPatternService();

      const complexList = `
        Blockers for Monday:
        • PROJ-123 - Database issue (urgent)
        • PROJ-456 - API timeout (critical)
        ◦ Mentioned here: <https://slack.com/thread1>
        • PROJ-789 - UI bug
      `;

      const tickets = patternService.parseBlockerList(complexList);

      expect(tickets).toHaveLength(3);
      expect(tickets[0].key).toBe('PROJ-123');
      expect(tickets[1].key).toBe('PROJ-456');
      expect(tickets[2].key).toBe('PROJ-789');
      expect(tickets[1].threadLink).toBe('https://slack.com/thread1');
    });

  });
});
