// Centralized constants for test bot detection and scan windows

export const TEST_BOT_IDS = [
  'B067SLP8AR5', // Cypress (general)
  'B067SMD5MAT', // Cypress (unverified)
  'B052372DK4H', // Jenkins/Playwright
];

export const JENKINS_PATTERN = 'kahoot-frontend-player-qa-playwright';

// Early morning cutoff for "current date" consideration
export const EARLY_MORNING_CUTOFF = 1; // 1:00 AM

// Lookback range for finding tests
export const MAX_LOOKBACK_DAYS = 7;

// Test result patterns for detection (kept for future use)
export const TEST_RESULT_PATTERNS = [
  'run #\\d+',
  'test results:',
  'failed run',
  'frontend-qa',
  'kahoot-frontend-player-qa-playwright',
  'failed.*test',
  'passed.*test',
  'specs for review',
];
