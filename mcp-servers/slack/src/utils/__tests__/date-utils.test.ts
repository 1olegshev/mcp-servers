/**
 * DateUtils Unit Tests
 * Tests the date utility functions including new extensions
 */

import { DateUtils } from '../date-utils';

describe('DateUtils', () => {
  describe('formatDateString', () => {
    it('should format date as YYYY-MM-DD', () => {
      const date = new Date('2026-01-15T12:30:00Z');
      expect(DateUtils.formatDateString(date)).toBe('2026-01-15');
    });

    it('should handle different dates', () => {
      expect(DateUtils.formatDateString(new Date('2025-12-31T23:59:59Z'))).toBe('2025-12-31');
      expect(DateUtils.formatDateString(new Date('2024-01-01T00:00:00Z'))).toBe('2024-01-01');
    });
  });

  describe('addDays', () => {
    it('should add positive days', () => {
      const date = new Date('2026-01-15T12:00:00Z');
      const result = DateUtils.addDays(date, 5);
      expect(DateUtils.formatDateString(result)).toBe('2026-01-20');
    });

    it('should subtract days with negative value', () => {
      const date = new Date('2026-01-15T12:00:00Z');
      const result = DateUtils.addDays(date, -3);
      expect(DateUtils.formatDateString(result)).toBe('2026-01-12');
    });

    it('should handle month boundaries', () => {
      const date = new Date('2026-01-30T12:00:00Z');
      const result = DateUtils.addDays(date, 5);
      expect(DateUtils.formatDateString(result)).toBe('2026-02-04');
    });

    it('should not mutate original date', () => {
      const original = new Date('2026-01-15T12:00:00Z');
      const originalTime = original.getTime();
      DateUtils.addDays(original, 10);
      expect(original.getTime()).toBe(originalTime);
    });
  });

  describe('getStartOfDay', () => {
    it('should return start of today when no argument', () => {
      const result = DateUtils.getStartOfDay();
      expect(result.getHours()).toBe(0);
      expect(result.getMinutes()).toBe(0);
      expect(result.getSeconds()).toBe(0);
      expect(result.getMilliseconds()).toBe(0);
    });

    it('should return start of day for "today" string', () => {
      const result = DateUtils.getStartOfDay('today');
      expect(result.getHours()).toBe(0);
      expect(result.getMinutes()).toBe(0);
    });

    it('should return start of specified date', () => {
      const result = DateUtils.getStartOfDay('2026-01-15');
      expect(result.getHours()).toBe(0);
      expect(result.getMinutes()).toBe(0);
      expect(result.getSeconds()).toBe(0);
    });
  });

  describe('getTestSearchWindows', () => {
    it('should return required properties', () => {
      const result = DateUtils.getTestSearchWindows('2026-01-15');
      expect(result).toHaveProperty('startOfToday');
      expect(result).toHaveProperty('todayDateStr');
      expect(result).toHaveProperty('beforeDateStr');
      expect(result).toHaveProperty('phase1Dates');
      expect(result).toHaveProperty('phase2After');
    });

    it('should include today in phase1Dates', () => {
      const result = DateUtils.getTestSearchWindows('2026-01-15');
      expect(result.phase1Dates.length).toBeGreaterThan(0);
      // Today should be first
      expect(result.phase1Dates[0]).toBe(result.todayDateStr);
    });

    it('should calculate phase2After correctly', () => {
      const result = DateUtils.getTestSearchWindows('2026-01-15', 7);
      // phase2After should be 7 days before the start date
      const startDate = new Date('2026-01-15');
      startDate.setHours(0, 0, 0, 0);
      const expected = DateUtils.formatDateString(DateUtils.addDays(startDate, -7));
      expect(result.phase2After).toBe(expected);
    });

    it('should handle custom maxLookbackDays', () => {
      const result3 = DateUtils.getTestSearchWindows('2026-01-15', 3);
      const result14 = DateUtils.getTestSearchWindows('2026-01-15', 14);

      const startDate = new Date('2026-01-15');
      startDate.setHours(0, 0, 0, 0);

      expect(result3.phase2After).toBe(DateUtils.formatDateString(DateUtils.addDays(startDate, -3)));
      expect(result14.phase2After).toBe(DateUtils.formatDateString(DateUtils.addDays(startDate, -14)));
    });
  });

  describe('getTodayDateString', () => {
    it('should return date in YYYY-MM-DD format', () => {
      const result = DateUtils.getTodayDateString();
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });

  describe('getDateRange', () => {
    it('should return oldest and latest timestamps', () => {
      const result = DateUtils.getDateRange('2026-01-15');
      expect(result).toHaveProperty('oldest');
      expect(result).toHaveProperty('latest');
      expect(parseFloat(result.oldest)).toBeLessThan(parseFloat(result.latest));
    });

    it('should throw for invalid date format', () => {
      expect(() => DateUtils.getDateRange('invalid-date')).toThrow();
    });

    it('should handle "today" string', () => {
      const result = DateUtils.getDateRange('today');
      expect(result.oldest).toBeDefined();
      expect(result.latest).toBeDefined();
    });
  });

  describe('formatTimestamp', () => {
    it('should convert Unix timestamp to readable date', () => {
      const timestamp = '1736956800'; // 2025-01-15 12:00:00 UTC
      const result = DateUtils.formatTimestamp(timestamp);
      expect(result).toBeTruthy();
      expect(typeof result).toBe('string');
    });
  });
});
