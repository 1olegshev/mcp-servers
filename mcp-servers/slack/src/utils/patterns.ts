/**
 * Centralized pattern definitions for blocker/critical detection
 * Single source of truth - all services should import from here
 */

export const BLOCKING_PATTERNS = {
  explicit: [
    /\bblocker\b/i,
    /\bblocking\b/i,
    /release\s*blocker/i,
  ],
  contextual: [
    /no[-_\s]?go/i,
    /@test-managers/i,
    /hotfix/i,
  ],
  // "blocks" requires release context to avoid false positives (UI blocks, etc.)
  releaseContext: /(\bblock(s)?\b|\bblocking\b).*\b(release|deploy(?:ment)?|prod(?:uction)?)\b/i,
};

export const CRITICAL_PATTERNS = {
  positive: [
    /\bcritical(?!\s*path)\b/i,
    /\burgent\b/i,
    /\bhigh\s+priority\b/i,
  ],
  negative: [
    /\bnot\s+(a\s+)?(super\s+)?high\s+priority\b/i,
    /\bnot\s+urgent\b/i,
    /\bnot\s+critical\b/i,
    /\blow\s+priority\b/i,
    /\bno\s+need\s+to\s+tackle\s+immediately\b/i,
  ],
  // Windowed negation: "not ... critical" within ~4 words
  windowNegation: /\b(?:not|isn['']?t|no|doesn['']?t(?:\s+have)?)\b(?:\W+\w+){0,4}\W+(?:critical|urgent|high\s+priority)\b/i,
};

export const RESOLUTION_PATTERNS = [
  { pattern: /\bresolved\b/i, keyword: 'resolved' },
  { pattern: /\bfixed\b/i, keyword: 'fixed' },
  { pattern: /\bdeployed\b/i, keyword: 'deployed' },
  { pattern: /not.*blocking/i, keyword: 'not blocking' },
  { pattern: /no.*longer.*blocking/i, keyword: 'no longer blocking' },
  { pattern: /\bnot a blocker\b/i, keyword: 'not a blocker' },
];

export const HOTFIX_PATTERNS = [
  /list\s+of\s+hotfixes/i,
  /hotfixes?\s*:/i,
  /•.*hotfix/i,
  /-.*hotfix/i,
  /hotfix\s+pr/i,
  /hotfix\s+branch/i,
  /prepare\s+a?\s*hotfix/i,
  /should.*hotfix/i,
];

export const UI_BLOCK_PATTERNS = [
  /add\s+block\s+dialog/i,
  /block\s+dialog/i,
  /block\s+panel/i,
  /code\s+block/i,
  /text\s+block/i,
  /content\s+block/i,
  /answer\s+blocks?/i,
  /question\s+blocks?/i,
  /image\s+blocks?/i,
  /video\s+blocks?/i,
  /slide\s+blocks?/i,
  /layout\s+blocks?/i,
  /blocks?\s+editor/i,
  /blocks?\s+component/i,
  /insert\s+blocks?/i,
  /delete\s+blocks?/i,
  /labels\s+of\s+.*blocks/i,
];

export const BLOCKING_KEYWORD_PATTERNS = [
  { pattern: /\bblocker\b/i, keyword: 'blocker' },
  { pattern: /\bblocking\b/i, keyword: 'blocking' },
  { pattern: /release\s*blocker/i, keyword: 'release blocker' },
  { pattern: /\bblocks?\b/i, keyword: 'blocks' },
  { pattern: /no.?go/i, keyword: 'no-go' },
  { pattern: /@test.managers/i, keyword: 'test-managers' },
  { pattern: /hotfix/i, keyword: 'hotfix' },
];

/**
 * Test Manager Update message patterns
 * These messages are summary/decision messages from the test manager
 * and should NOT be treated as blocker sources
 *
 * Two message types:
 * 1. Normal day: "Frontend release update" - contains release decision
 * 2. Friday: "Frontend release pipeline aborted" - no release on Fridays
 */
export const TEST_MANAGER_UPDATE_PATTERNS = {
  // Primary identifiers - must match for a message to be considered a TM update
  // Matches both "Frontend release update" and "Frontend release pipeline aborted"
  header: /frontend\s+release\s+(?:update|pipeline\s+aborted)/i,

  // Specific header for normal release update
  headerUpdate: /frontend\s+release\s+update/i,

  // Specific header for Friday (pipeline aborted)
  headerAborted: /frontend\s+release\s+pipeline\s+aborted/i,

  // Friday indicator - often mentions it's Friday
  fridayIndicator: /it['']?s\s+friday/i,

  // Decision patterns (expanded to catch variations)
  canRelease: /we\s+(?:can|are\s+good\s+to)\s+release/i,
  goodToRelease: /good\s+to\s+(?:go|release)/i,
  canStartHotfixing: /we\s+(?:can|will)\s+(?:start\s+)?hotfix(?:ing)?/i,
  willHotfix: /will\s+hotfix/i,

  // Status patterns
  manualTestingDone: /manual\s+testing(?:\s+(?:and\s+rc|is))?[:\s]+done/i,
  manualTestingAlmostDone: /manual\s+testing(?:\s+(?:and\s+rc))?[:\s]+(?:almost\s+)?(?:completed?|close)/i,
  autotestsReviewed: /autotests?[:\s]+reviewed/i,

  // The @test-managers mention often appears in these updates
  testManagersMention: /@test-managers/i,
};
