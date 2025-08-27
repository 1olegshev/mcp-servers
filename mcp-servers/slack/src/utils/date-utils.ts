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
    const targetDate = dateStr ? new Date(dateStr) : new Date();
    const startOfDay = new Date(targetDate);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(targetDate);
    endOfDay.setHours(23, 59, 59, 999);

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
    const now = requestDate ? new Date(requestDate) : new Date();
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
}