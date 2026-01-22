/**
 * Date and Time Utilities
 */

export class DateUtils {
  
  /**
   * Get today's date in YYYY-MM-DD format
   */
  static getTodayDateString(): string {
    const today = new Date();
    return today.toISOString().split('T')[0];
  }

  /**
   * Get Unix timestamp range for a specific date
   */
  static getDateRange(dateStr?: string): { oldest: string; latest: string } {
    let targetDate: Date;

    if (!dateStr || dateStr === 'today') {
      targetDate = new Date();
    } else {
      // Parse date string and ensure it's treated as UTC to avoid timezone issues
      const [year, month, day] = dateStr.split('-').map(Number);
      targetDate = new Date(Date.UTC(year, month - 1, day)); // month is 0-indexed
      // Check if the date is invalid
      if (isNaN(targetDate.getTime())) {
        throw new Error(`Invalid date format: ${dateStr}. Use YYYY-MM-DD format or 'today'.`);
      }
    }

    const startOfDay = new Date(targetDate);
    startOfDay.setUTCHours(0, 0, 0, 0);
    const endOfDay = new Date(targetDate);
    endOfDay.setUTCHours(23, 59, 59, 999);

    return {
      oldest: (startOfDay.getTime() / 1000).toString(),
      latest: (endOfDay.getTime() / 1000).toString(),
    };
  }

  /**
   * Get smart date range for auto-test lookback
   * - Normal days: previous day
   * - Monday: Friday 16:00 - Sunday 23:59
   * - Early morning (before 1 AM): previous day
   * - Fallback: up to 7 days lookback
   */
  static getAutoTestDateRange(requestDate?: string, maxLookbackDays: number = 7): { oldest: string; latest: string } {
    let now: Date;
    
    if (!requestDate || requestDate === 'today') {
      now = new Date();
    } else {
      now = new Date(requestDate);
      // Check if the date is invalid
      if (isNaN(now.getTime())) {
        throw new Error(`Invalid date format: ${requestDate}. Use YYYY-MM-DD format or 'today'.`);
      }
    }
    
    const currentHour = now.getHours();
    
    // If it's very early morning (before 1 AM), treat as previous day
    const effectiveDate = currentHour < 1 ? new Date(now.getTime() - 24 * 60 * 60 * 1000) : now;
    
    const dayOfWeek = effectiveDate.getDay(); // 0 = Sunday, 1 = Monday, etc.
    
    let startDate: Date;
    let endDate: Date;
    
    if (dayOfWeek === 1) { // Monday
      // Look back to Friday 16:00 through Sunday night
      startDate = new Date(effectiveDate);
      startDate.setDate(startDate.getDate() - 3); // Go back to Friday
      startDate.setHours(16, 0, 0, 0); // 16:00 Friday
      
      endDate = new Date(effectiveDate);
      endDate.setDate(endDate.getDate() - 1); // Sunday
      endDate.setHours(23, 59, 59, 999); // End of Sunday
    } else {
      // Normal case: previous day
      startDate = new Date(effectiveDate);
      startDate.setDate(startDate.getDate() - 1);
      startDate.setHours(0, 0, 0, 0);
      
      endDate = new Date(effectiveDate);
      endDate.setDate(endDate.getDate() - 1);
      endDate.setHours(23, 59, 59, 999);
    }
    
    // Fallback: if no results, extend to maxLookbackDays
    const fallbackStart = new Date(effectiveDate);
    fallbackStart.setDate(fallbackStart.getDate() - maxLookbackDays);
    fallbackStart.setHours(0, 0, 0, 0);
    
    return {
      oldest: Math.min(startDate.getTime(), fallbackStart.getTime()) / 1000 + '',
      latest: (endDate.getTime() / 1000).toString(),
    };
  }

  /**
   * Format Unix timestamp to readable date
   */
  static formatTimestamp(timestamp: string): string {
    return new Date(parseFloat(timestamp) * 1000).toLocaleString();
  }

  /**
   * Format a Date as YYYY-MM-DD string
   */
  static formatDateString(date: Date): string {
    return date.toISOString().split('T')[0];
  }

  /**
   * Add (or subtract) days from a date
   */
  static addDays(date: Date, days: number): Date {
    return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
  }

  /**
   * Get start of day (midnight) for a given date string or today
   */
  static getStartOfDay(dateStr?: string): Date {
    const d = dateStr ? (dateStr === 'today' ? new Date() : new Date(dateStr)) : new Date();
    const result = new Date(d);
    result.setHours(0, 0, 0, 0);
    return result;
  }

  /**
   * Build test search windows for phased lookback
   * Returns dates to search in priority order, plus a fallback cutoff
   */
  static getTestSearchWindows(dateStr?: string, maxLookbackDays: number = 7): {
    startOfToday: Date;
    todayDateStr: string;
    beforeDateStr: string;
    phase1Dates: string[];
    phase2After: string;
    fridayCutoffTs?: number;
    dailyCutoffTs: number;
  } {
    const startOfToday = this.getStartOfDay(dateStr);
    // Use requested date, not current date - important for historical queries
    const targetDate = dateStr && dateStr !== 'today' ? new Date(dateStr) : new Date();
    const todayDateStr = this.formatDateString(targetDate);
    const beforeDateStr = this.formatDateString(this.addDays(startOfToday, 1));

    const dayOfWeek = targetDate.getDay();
    const phase1Dates: string[] = [];

    // Daily cutoff: tests after 16:00 CET (15:00 UTC) are for the NEXT day's release
    // This applies to ALL days, not just Fridays
    const dailyCutoff = new Date(startOfToday);
    dailyCutoff.setUTCHours(15, 0, 0, 0); // 16:00 CET = 15:00 UTC (winter time)
    const dailyCutoffTs = dailyCutoff.getTime();

    // Friday cutoff is the same as daily cutoff but named separately for clarity
    // (Friday tests after 16:00 CET are for Monday's build)
    const fridayCutoffTs = dayOfWeek === 5 ? dailyCutoffTs : undefined;

    if (dayOfWeek === 1) {
      // Monday: try Sun -> Sat -> Fri
      phase1Dates.push(this.formatDateString(this.addDays(startOfToday, -1))); // Sunday
      phase1Dates.push(this.formatDateString(this.addDays(startOfToday, -2))); // Saturday
      phase1Dates.push(this.formatDateString(this.addDays(startOfToday, -3))); // Friday
    } else {
      // Other days: yesterday only
      phase1Dates.push(this.formatDateString(this.addDays(startOfToday, -1)));
    }

    // Include the requested date as a search window
    phase1Dates.unshift(todayDateStr);

    const phase2After = this.formatDateString(this.addDays(startOfToday, -maxLookbackDays));

    return { startOfToday, todayDateStr, beforeDateStr, phase1Dates, phase2After, fridayCutoffTs, dailyCutoffTs };
  }
}