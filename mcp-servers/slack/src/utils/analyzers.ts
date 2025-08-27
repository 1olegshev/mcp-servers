/**
 * Text Analysis and Pattern Detection Utilities
 */

import { SlackMessage, JiraTicketInfo } from '../types/index.js';

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
    const lowerText = text.toLowerCase();
    
    const blockingKeywords = ['blocker', 'blocking', 'release blocker', 'blocks release', 'block release'];
    const criticalKeywords = ['critical', 'urgent', 'high priority', 'must fix', 'critical issue'];
    
    const isBlocking = blockingKeywords.some(keyword => lowerText.includes(keyword));
    const isCritical = criticalKeywords.some(keyword => lowerText.includes(keyword));
    
    return { isBlocking, isCritical };
  }

  /**
   * Check if message is from a test automation bot
   * Improved detection with more specific patterns
   */
  static isTestBot(message: SlackMessage): boolean {
    // More specific bot patterns to reduce false positives
    const botPatterns = [
      'cypress', 'playwright', 'selenium', 'jest', 'mocha',
      'automation', 'testbot', 'ci-bot', 'qa-bot',
      'jenkins', 'github-actions', 'gitlab-ci', 'circle-ci',
      'build-bot', 'deploy-bot'
    ];
    
    const username = (message.username || message.bot_profile?.name || '').toLowerCase();
    const text = (message.text || '').toLowerCase();
    
    // Check if username contains bot patterns
    const usernameMatch = botPatterns.some(pattern => username.includes(pattern));
    
    // Check if text contains test-specific patterns
    const testPatterns = [
      'test suite', 'test run', 'tests passed', 'tests failed',
      'test execution', 'automated test', 'e2e test'
    ];
    const textMatch = testPatterns.some(pattern => text.includes(pattern));
    
    return usernameMatch || textMatch;
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
}