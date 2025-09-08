/**
 * BlockerPatternService Unit Tests
 * Tests the core text analysis and pattern matching logic
 */

import { BlockerPatternService } from '../services/blocker-pattern.service';

describe('BlockerPatternService', () => {
  let service: BlockerPatternService;

  beforeEach(() => {
    service = new BlockerPatternService('https://example.atlassian.net');
  });

  describe('hasBlockingIndicators', () => {
    it('should detect explicit blocker keywords', () => {
      expect(service.hasBlockingIndicators('This is a blocker')).toBe(true);
      expect(service.hasBlockingIndicators('Release blocker detected')).toBe(true);
      expect(service.hasBlockingIndicators('This is blocking deployment')).toBe(true);
    });

    it('should detect release context blockers', () => {
      expect(service.hasBlockingIndicators('This blocks the release')).toBe(true);
      expect(service.hasBlockingIndicators('Blocking production deployment')).toBe(true);
    });

    it('should detect @test-managers mentions', () => {
      expect(service.hasBlockingIndicators('Please @test-managers review this')).toBe(true);
    });

    it('should detect hotfix keywords', () => {
      expect(service.hasBlockingIndicators('Emergency hotfix needed')).toBe(true);
    });

    it('should detect no-go patterns', () => {
      expect(service.hasBlockingIndicators('No go for release')).toBe(true);
      expect(service.hasBlockingIndicators('No-go situation')).toBe(true);
    });

    it('should detect explicit blocking words', () => {
      expect(service.hasBlockingIndicators('This blocks the UI')).toBe(false); // "blocks" is generic
      expect(service.hasBlockingIndicators('Blocking the view')).toBe(true); // "blocking" is explicit
    });
  });

  describe('hasCriticalIndicators', () => {
    it('should detect explicit critical keywords', () => {
      expect(service.hasCriticalIndicators('This is critical')).toBe(true);
      expect(service.hasCriticalIndicators('Critical issue found')).toBe(true);
    });

    it('should detect urgent patterns', () => {
      expect(service.hasCriticalIndicators('This is urgent')).toBe(true);
      expect(service.hasCriticalIndicators('Urgent fix needed')).toBe(true);
    });

    it('should detect high priority patterns', () => {
      expect(service.hasCriticalIndicators('High priority issue')).toBe(true);
      expect(service.hasCriticalIndicators('Super high priority')).toBe(true);
    });

    it('should handle negation correctly', () => {
      expect(service.hasCriticalIndicators('Not critical')).toBe(false);
      expect(service.hasCriticalIndicators('Not urgent')).toBe(false);
      expect(service.hasCriticalIndicators('Not high priority')).toBe(false);
    });

    it('should handle windowed negation', () => {
      expect(service.hasCriticalIndicators('This is not a critical issue')).toBe(false);
      expect(service.hasCriticalIndicators('Definitely not urgent')).toBe(false);
    });
  });

  describe('extractTickets', () => {
    it('should extract JIRA ticket keys', () => {
      const text = 'Found issues in PROJ-123 and KAH-456';
      const tickets = service.extractTickets(text);

      expect(tickets).toHaveLength(2);
      expect(tickets[0].key).toBe('PROJ-123');
      expect(tickets[1].key).toBe('KAH-456');
      expect(tickets[0].url).toBe('https://example.atlassian.net/browse/PROJ-123');
    });

    it('should handle multiple ticket formats', () => {
      const text = 'Tickets: ABC-123, DEF-456, GHI-789';
      const tickets = service.extractTickets(text);

      expect(tickets).toHaveLength(3);
      expect(tickets.map(t => t.key)).toEqual(['ABC-123', 'DEF-456', 'GHI-789']);
    });

    it('should return empty array for no tickets', () => {
      const tickets = service.extractTickets('No tickets mentioned here');
      expect(tickets).toHaveLength(0);
    });
  });

  describe('parseBlockerList', () => {
    it('should parse explicit blocker lists', () => {
      const text = 'Blockers for today:\n• PROJ-123 - Database issue\n• PROJ-456 - API problem';
      const tickets = service.parseBlockerList(text);

      expect(tickets).toHaveLength(2);
      expect(tickets[0].key).toBe('PROJ-123');
      expect(tickets[1].key).toBe('PROJ-456');
    });

    it('should handle different blocker list formats', () => {
      const text = 'Blockers:\n- ABC-123\n- DEF-456';
      const tickets = service.parseBlockerList(text);

      expect(tickets).toHaveLength(2);
      expect(tickets[0].key).toBe('ABC-123');
    });

    it('should extract thread links when available', () => {
      const text = 'Blockers:\n• PROJ-123 ◦ Mentioned here <https://slack.com/thread|thread>';
      const tickets = service.parseBlockerList(text);

      expect(tickets[0].threadLink).toBe('https://slack.com/thread');
    });
  });

  describe('extractBlockingKeywords', () => {
    it('should extract blocking keywords from text', () => {
      const text = 'This is a blocker and also blocking the release';
      const keywords = service.extractBlockingKeywords(text);

      expect(keywords).toContain('blocker');
      expect(keywords).toContain('blocking');
    });

    it('should return unique keywords', () => {
      const text = 'Blocker blocker BLOCKER'; // Same word multiple times
      const keywords = service.extractBlockingKeywords(text);

      expect(keywords).toEqual(['blocker']);
    });
  });

  describe('extractResolutionKeywords', () => {
    it('should extract resolution keywords', () => {
      const text = 'Issue resolved and fixed';
      const keywords = service.extractResolutionKeywords(text);

      expect(keywords).toContain('resolved');
      expect(keywords).toContain('fixed');
    });

    it('should detect complex resolution patterns', () => {
      const text = 'Fix is ready for deployment';
      const keywords = service.extractResolutionKeywords(text);

      expect(keywords).toContain('ready');
    });
  });
});
