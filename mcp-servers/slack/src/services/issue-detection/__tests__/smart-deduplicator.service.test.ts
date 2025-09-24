/**
 * SmartDeduplicatorService Unit Tests
 * Tests the deduplication logic that preserves thread context
 */

import { SmartDeduplicatorService } from '../services/smart-deduplicator.service';

describe('SmartDeduplicatorService', () => {
  let service: SmartDeduplicatorService;

  beforeEach(() => {
    service = new SmartDeduplicatorService();
  });

  describe('deduplicateWithPriority', () => {
    const createMockIssue = (
      id: string,
      type: 'blocking' | 'critical' | 'blocking_resolved',
      hasThread = false,
      hasPermalink = false,
      hotfixCommitment = false
    ) => ({
      type,
      text: `Issue ${id}`,
      tickets: [{ key: `PROJ-${id}`, url: `https://example.com/PROJ-${id}` }],
      timestamp: `123456789${id}`,
      hasThread,
      permalink: hasPermalink ? `https://slack.com/${id}` : undefined,
      hotfixCommitment
    });

    it('should prioritize thread context over list-only issues', () => {
      const threadIssue = createMockIssue('1', 'blocking', true, true);
      const listIssue = createMockIssue('1', 'blocking', false, false);

      const result = service.deduplicateWithPriority([listIssue, threadIssue]);

      expect(result).toHaveLength(1);
      expect(result[0]).toBe(threadIssue);
      expect(result[0].hasThread).toBe(true);
      expect(result[0].permalink).toBeDefined();
    });

    it('should prioritize thread context over permalink-only', () => {
      const permalinkIssue = createMockIssue('2', 'blocking', false, true);
      const threadOnlyIssue = createMockIssue('2', 'blocking', true, false);

      const result = service.deduplicateWithPriority([threadOnlyIssue, permalinkIssue]);

      expect(result).toHaveLength(1);
      expect(result[0]).toBe(threadOnlyIssue); // Thread context has higher priority
      expect(result[0].hasThread).toBe(true);
    });

    it('should handle multiple different tickets', () => {
      const issue1 = createMockIssue('1', 'blocking', true, true);
      const issue2 = createMockIssue('2', 'critical', false, false);
      const issue3 = createMockIssue('3', 'blocking', true, true);

      const result = service.deduplicateWithPriority([issue1, issue2, issue3]);

      expect(result).toHaveLength(3);
      expect(result.map(i => i.tickets[0].key)).toEqual(['PROJ-1', 'PROJ-2', 'PROJ-3']);
    });

    it('should deduplicate same ticket with different contexts', () => {
      const oldThreadIssue = createMockIssue('1', 'blocking', true, false);
      const newPermalinkIssue = createMockIssue('1', 'blocking', false, true);

      const result = service.deduplicateWithPriority([oldThreadIssue, newPermalinkIssue]);

      expect(result).toHaveLength(1);
      expect(result[0]).toBe(oldThreadIssue); // Thread context has higher priority
    });

    it('should keep list-only hotfix blockers even without thread context', () => {
      const hotfixIssue = createMockIssue('4', 'blocking', false, false, true);
      const criticalIssue = createMockIssue('4', 'critical', false, false, false);

      const result = service.deduplicateWithPriority([criticalIssue, hotfixIssue]);

      expect(result).toHaveLength(1);
      expect(result[0]).toBe(hotfixIssue);
      expect(result[0].hotfixCommitment).toBe(true);
    });
  });

  describe('mergeDuplicateIssues', () => {
    it('should merge context from multiple issues', () => {
      const issue1 = {
        type: 'blocking' as const,
        text: 'Issue from thread',
        tickets: [{ key: 'PROJ-1', url: 'https://example.com/PROJ-1' }],
        timestamp: '1234567891',
        hasThread: true,
        permalink: 'https://slack.com/thread1'
      };

      const issue2 = {
        type: 'blocking' as const,
        text: 'Issue from list',
        tickets: [{ key: 'PROJ-1', url: 'https://example.com/PROJ-1' }],
        timestamp: '1234567892',
        hasThread: false
      };

      const result = service.mergeDuplicateIssues([issue1, issue2]);

      expect(result.hasThread).toBe(true);
      expect(result.permalink).toBe('https://slack.com/thread1');
      expect(result.text).toContain('Issue from thread');
    });

    it('should select best issue based on priority, then most recent', () => {
      const oldThreadIssue = {
        type: 'blocking' as const,
        text: 'Old thread issue',
        tickets: [{ key: 'PROJ-1' }],
        timestamp: '1234567890',
        hasThread: true
      };

      const newListIssue = {
        type: 'blocking' as const,
        text: 'New list issue',
        tickets: [{ key: 'PROJ-1' }],
        timestamp: '1234567899',
        hasThread: false
      };

      const result = service.mergeDuplicateIssues([oldThreadIssue, newListIssue]);

      // Should prefer thread context over newer timestamp
      expect(result.hasThread).toBe(true);
      expect(result.timestamp).toBe('1234567890');
    });
  });

  describe('areDuplicates', () => {
    const createIssue = (ticketKey: string) => ({
      type: 'blocking' as const,
      text: 'Test issue',
      tickets: [{ key: ticketKey }],
      timestamp: '1234567890',
      hasThread: false
    });

    it('should identify issues with same ticket as duplicates', () => {
      const issue1 = createIssue('PROJ-123');
      const issue2 = createIssue('PROJ-123');

      expect(service.areDuplicates(issue1, issue2)).toBe(true);
    });

    it('should identify issues with different tickets as non-duplicates', () => {
      const issue1 = createIssue('PROJ-123');
      const issue2 = createIssue('PROJ-456');

      expect(service.areDuplicates(issue1, issue2)).toBe(false);
    });
  });

  describe('combineContextTexts', () => {
    it('should combine multiple texts intelligently', () => {
      const texts = [
        'Database connection failing',
        'Users cannot log in',
        'System is down'
      ];

      const result = (service as any).combineContextTexts(texts);

      expect(result.length).toBeLessThan(200); // Should truncate
      expect(result).toContain('Database');
      expect(result).toContain('Users');
    });

    it('should handle single text', () => {
      const texts = ['Single issue description'];
      const result = (service as any).combineContextTexts(texts);

      expect(result).toBe('Single issue description');
    });

    it('should handle empty texts', () => {
      const result = (service as any).combineContextTexts([]);
      expect(result).toBe('');
    });
  });
});
