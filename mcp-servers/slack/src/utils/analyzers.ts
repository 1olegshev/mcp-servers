/**
 * Text Analysis and Pattern Detection Utilities
 */

import { SlackMessage, JiraTicketInfo } from '../types/index.js';
import { HOTFIX_PATTERNS, UI_BLOCK_PATTERNS, JIRA_TICKET_PATTERN } from './patterns.js';

export class TextAnalyzer {

  /**
   * Extract JIRA ticket numbers from text and create ticket info objects
   */
  static extractTickets(text: string, jiraBaseUrl?: string): JiraTicketInfo[] {
    // Reset lastIndex for global regex
    JIRA_TICKET_PATTERN.lastIndex = 0;
    const ticketKeys: string[] = [];
    let match;
    while ((match = JIRA_TICKET_PATTERN.exec(text)) !== null) {
      ticketKeys.push(match[1]);
    }

    return ticketKeys.map(key => ({
      key,
      url: jiraBaseUrl ? `${jiraBaseUrl}/browse/${key}` : undefined,
      project: key.split('-')[0]
    }));
  }

  /**
   * Determine test type and status from bot message
   * Enhanced to handle the actual Cypress/Jenkins format
   */
  static analyzeTestResult(message: SlackMessage): {
    testType: string;
    status: 'passed' | 'failed' | 'pending';
  } {
    const text = message.text || '';
    const lowerText = text.toLowerCase();
    
    // Determine test type based on actual patterns from screenshots
    let testType = 'unknown';
    
    // Cypress patterns
    if (lowerText.includes('run #') && lowerText.includes('frontend-qa-unverified')) {
      testType = 'Cypress (frontend-qa-unverified)';
    } else if (lowerText.includes('run #') && lowerText.includes('frontend-qa')) {
      testType = 'Cypress (frontend-qa)';
    } else if (lowerText.includes('run #')) {
      testType = 'Cypress (general)';
    }
    
    // Jenkins/Playwright patterns
    else if (lowerText.includes('kahoot-frontend-player-qa-playwright')) {
      testType = 'Jenkins (playwright)';
    }
    
    // Generic patterns as fallback
    else if (lowerText.includes('cypress')) {
      testType = 'Cypress';
    } else if (lowerText.includes('playwright')) {
      testType = 'Playwright';
    }
    
    // Determine status from actual bot message patterns
    let status: 'passed' | 'failed' | 'pending' = 'pending';
    
    // Look for specific status indicators
    if (lowerText.includes('failed run') || 
        lowerText.includes('test results: failed') ||
        text.includes('❌') || 
        lowerText.includes('failed:')) {
      status = 'failed';
    } else if (lowerText.includes('passed') || 
               text.includes('✅') || 
               lowerText.includes('success') ||
               text.includes('🟢')) {
      status = 'passed';
    }
    
    return { testType, status };
  }

  /**
   * Detect UI/technical "block" terminology that should NOT be treated as release blockers
   * Centralized helper to avoid false positives from UI component names
   */
  static hasUIBlockContext(text: string): boolean {
    const lowerText = (text || '').toLowerCase();
    return UI_BLOCK_PATTERNS.some(pattern => pattern.test(lowerText));
  }

  /**
   * Guarded exception for mentions of ad blocker/ad-blocker that should not count as blockers
   * Only ignore when there is NO nearby release/deploy/prod context
   */
  static isAdBlockerNonReleaseContext(text: string): boolean {
    const lowerText = (text || '').toLowerCase();
    const mentionsAdBlocker = /\bad[-\s]?blockers?\b/i.test(lowerText);
    if (!mentionsAdBlocker) return false;

    const hasReleaseContext = /\b(release|deploy(?:ment)?|prod(?:uction)?)\b/i.test(lowerText);
    return !hasReleaseContext;
  }

  /**
   * Check if a message text indicates hotfix context
   * BUSINESS RULE: Hotfixes are ONLY made for blockers
   */
  static isHotfixContext(text: string): boolean {
    const lowerText = (text || '').toLowerCase();
    return HOTFIX_PATTERNS.some(pattern => pattern.test(lowerText));
  }
}