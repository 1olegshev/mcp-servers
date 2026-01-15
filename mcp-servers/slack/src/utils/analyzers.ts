/**
 * Text Analysis and Pattern Detection Utilities
 */

import { SlackMessage, JiraTicketInfo } from '../types/index.js';
import { CRITICAL_PATTERNS, HOTFIX_PATTERNS, UI_BLOCK_PATTERNS } from './patterns.js';

export class TextAnalyzer {
  
  /**
   * Extract JIRA ticket numbers from text and create ticket info objects
   */
  static extractTickets(text: string, jiraBaseUrl?: string): JiraTicketInfo[] {
    const ticketPattern = /[A-Z]+-\d+/g;
    const ticketKeys = text.match(ticketPattern) || [];
    
    return ticketKeys.map(key => ({
      key,
      url: jiraBaseUrl ? `${jiraBaseUrl}/browse/${key}` : undefined,
      project: key.split('-')[0]
    }));
  }

  /**
   * Analyze issue severity from text content
   */
  static analyzeIssueSeverity(text: string): { isBlocking: boolean; isCritical: boolean } {
    const lower = (text || '').toLowerCase();

    const blockingKeywords = ['blocker', 'blocking', 'release blocker', 'blocks release', 'block release', 'hotfix'];
    const isBlocking = blockingKeywords.some(keyword => lower.includes(keyword));

    // Negation-aware critical detection using centralized patterns
    const criticalPositive = CRITICAL_PATTERNS.positive.some(pattern => pattern.test(lower));
    const criticalNegative = CRITICAL_PATTERNS.negative.some(pattern => pattern.test(lower));
    const windowNegation = CRITICAL_PATTERNS.windowNegation.test(lower);
    const isCritical = criticalPositive && !criticalNegative && !windowNegation;

    return { isBlocking, isCritical };
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
   * Extract detailed test information from bot message
   * Parses the actual format shown in screenshots
   */
  static parseTestDetails(text: string): {
    failedCount: number;
    passedCount: number;
    failedTests: string[];
    hasSpecs: boolean;
  } {
    const details = {
      failedCount: 0,
      passedCount: 0,
      failedTests: [] as string[],
      hasSpecs: false
    };

    // Extract counts (Failed: 5, Passed: 1173, etc.)
    const failedMatch = text.match(/failed:\s*(\d+)/i);
    const passedMatch = text.match(/passed:\s*(\d+)/i);
    
    if (failedMatch) details.failedCount = parseInt(failedMatch[1]);
    if (passedMatch) details.passedCount = parseInt(passedMatch[1]);

    // Extract specific test file names
    const specPattern = /[\w\/-]+_spec\.ts|[\w\/-]+\.spec\.js|[\w\/-]+_test\.ts|[\w\/-]+\.test\.js/g;
    const testFiles = text.match(specPattern) || [];
    details.failedTests = testFiles;
    details.hasSpecs = testFiles.length > 0;

    return details;
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