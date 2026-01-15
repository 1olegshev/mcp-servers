/**
 * Central Pattern Registry Tests
 * Tests the pattern constants used across the codebase
 */

import {
  BLOCKING_PATTERNS,
  CRITICAL_PATTERNS,
  RESOLUTION_PATTERNS,
  HOTFIX_PATTERNS,
  UI_BLOCK_PATTERNS,
  BLOCKING_KEYWORD_PATTERNS,
} from '../patterns';

describe('BLOCKING_PATTERNS', () => {
  describe('explicit patterns', () => {
    it('should match "blocker" as a word', () => {
      expect(BLOCKING_PATTERNS.explicit.some(p => p.test('This is a blocker'))).toBe(true);
      expect(BLOCKING_PATTERNS.explicit.some(p => p.test('BLOCKER'))).toBe(true);
    });

    it('should match "blocking" as a word', () => {
      expect(BLOCKING_PATTERNS.explicit.some(p => p.test('This is blocking release'))).toBe(true);
    });

    it('should match "release blocker"', () => {
      expect(BLOCKING_PATTERNS.explicit.some(p => p.test('release blocker found'))).toBe(true);
      expect(BLOCKING_PATTERNS.explicit.some(p => p.test('releaseblocker'))).toBe(true);
    });

    it('should not match partial words', () => {
      expect(BLOCKING_PATTERNS.explicit.some(p => p.test('unblocker'))).toBe(false);
    });
  });

  describe('contextual patterns', () => {
    it('should match no-go patterns', () => {
      expect(BLOCKING_PATTERNS.contextual.some(p => p.test('no-go'))).toBe(true);
      expect(BLOCKING_PATTERNS.contextual.some(p => p.test('no go'))).toBe(true);
      expect(BLOCKING_PATTERNS.contextual.some(p => p.test('no_go'))).toBe(true);
      expect(BLOCKING_PATTERNS.contextual.some(p => p.test('nogo'))).toBe(true);
    });

    it('should match @test-managers mention', () => {
      expect(BLOCKING_PATTERNS.contextual.some(p => p.test('cc @test-managers'))).toBe(true);
    });

    it('should match hotfix', () => {
      expect(BLOCKING_PATTERNS.contextual.some(p => p.test('hotfix needed'))).toBe(true);
    });
  });

  describe('releaseContext pattern', () => {
    it('should match blocks + release context', () => {
      expect(BLOCKING_PATTERNS.releaseContext.test('this blocks the release')).toBe(true);
      expect(BLOCKING_PATTERNS.releaseContext.test('blocks deployment')).toBe(true);
      expect(BLOCKING_PATTERNS.releaseContext.test('blocking production')).toBe(true);
    });

    it('should not match blocks without release context', () => {
      expect(BLOCKING_PATTERNS.releaseContext.test('this blocks the UI')).toBe(false);
    });
  });
});

describe('CRITICAL_PATTERNS', () => {
  describe('positive patterns', () => {
    it('should match critical (but not critical path)', () => {
      expect(CRITICAL_PATTERNS.positive.some(p => p.test('critical issue'))).toBe(true);
      expect(CRITICAL_PATTERNS.positive.some(p => p.test('critical path'))).toBe(false);
    });

    it('should match urgent', () => {
      expect(CRITICAL_PATTERNS.positive.some(p => p.test('urgent fix needed'))).toBe(true);
    });

    it('should match high priority', () => {
      expect(CRITICAL_PATTERNS.positive.some(p => p.test('high priority task'))).toBe(true);
    });
  });

  describe('negative patterns', () => {
    it('should match negations', () => {
      expect(CRITICAL_PATTERNS.negative.some(p => p.test('not critical'))).toBe(true);
      expect(CRITICAL_PATTERNS.negative.some(p => p.test('not urgent'))).toBe(true);
      expect(CRITICAL_PATTERNS.negative.some(p => p.test('not a super high priority'))).toBe(true);
      expect(CRITICAL_PATTERNS.negative.some(p => p.test('low priority'))).toBe(true);
      expect(CRITICAL_PATTERNS.negative.some(p => p.test('no need to tackle immediately'))).toBe(true);
    });
  });

  describe('windowNegation pattern', () => {
    it('should match negation within window', () => {
      expect(CRITICAL_PATTERNS.windowNegation.test('this is not a critical issue')).toBe(true);
      expect(CRITICAL_PATTERNS.windowNegation.test("isn't urgent")).toBe(true);
      expect(CRITICAL_PATTERNS.windowNegation.test('no really urgent')).toBe(true);
    });
  });
});

describe('RESOLUTION_PATTERNS', () => {
  it('should match resolution keywords', () => {
    expect(RESOLUTION_PATTERNS.some(p => p.pattern.test('resolved'))).toBe(true);
    expect(RESOLUTION_PATTERNS.some(p => p.pattern.test('fixed'))).toBe(true);
    expect(RESOLUTION_PATTERNS.some(p => p.pattern.test('deployed'))).toBe(true);
    expect(RESOLUTION_PATTERNS.some(p => p.pattern.test('not blocking anymore'))).toBe(true);
    expect(RESOLUTION_PATTERNS.some(p => p.pattern.test('no longer blocking'))).toBe(true);
    expect(RESOLUTION_PATTERNS.some(p => p.pattern.test('not a blocker'))).toBe(true);
  });

  it('should have correct keywords', () => {
    const resolved = RESOLUTION_PATTERNS.find(p => p.keyword === 'resolved');
    expect(resolved).toBeDefined();
    expect(resolved?.pattern.test('Issue resolved')).toBe(true);
  });
});

describe('HOTFIX_PATTERNS', () => {
  it('should match hotfix list patterns', () => {
    expect(HOTFIX_PATTERNS.some(p => p.test('list of hotfixes'))).toBe(true);
    expect(HOTFIX_PATTERNS.some(p => p.test('hotfixes:'))).toBe(true);
    expect(HOTFIX_PATTERNS.some(p => p.test('hotfixes: KAH-123'))).toBe(true);
  });

  it('should match bullet points with hotfix', () => {
    expect(HOTFIX_PATTERNS.some(p => p.test('• hotfix for KAH-123'))).toBe(true);
    expect(HOTFIX_PATTERNS.some(p => p.test('- hotfix PR merged'))).toBe(true);
  });

  it('should match hotfix PR/branch references', () => {
    expect(HOTFIX_PATTERNS.some(p => p.test('hotfix PR ready'))).toBe(true);
    expect(HOTFIX_PATTERNS.some(p => p.test('hotfix branch created'))).toBe(true);
  });

  it('should match prepare hotfix patterns', () => {
    expect(HOTFIX_PATTERNS.some(p => p.test('prepare a hotfix'))).toBe(true);
    expect(HOTFIX_PATTERNS.some(p => p.test('should hotfix this'))).toBe(true);
  });
});

describe('UI_BLOCK_PATTERNS', () => {
  it('should match UI block terminology', () => {
    expect(UI_BLOCK_PATTERNS.some(p => p.test('add block dialog'))).toBe(true);
    expect(UI_BLOCK_PATTERNS.some(p => p.test('block dialog'))).toBe(true);
    expect(UI_BLOCK_PATTERNS.some(p => p.test('code block'))).toBe(true);
    expect(UI_BLOCK_PATTERNS.some(p => p.test('text block'))).toBe(true);
    expect(UI_BLOCK_PATTERNS.some(p => p.test('content block'))).toBe(true);
  });

  it('should match educational content blocks', () => {
    expect(UI_BLOCK_PATTERNS.some(p => p.test('answer blocks'))).toBe(true);
    expect(UI_BLOCK_PATTERNS.some(p => p.test('question block'))).toBe(true);
    expect(UI_BLOCK_PATTERNS.some(p => p.test('image blocks'))).toBe(true);
    expect(UI_BLOCK_PATTERNS.some(p => p.test('video block'))).toBe(true);
    expect(UI_BLOCK_PATTERNS.some(p => p.test('slide blocks'))).toBe(true);
  });

  it('should match block editor terminology', () => {
    expect(UI_BLOCK_PATTERNS.some(p => p.test('blocks editor'))).toBe(true);
    expect(UI_BLOCK_PATTERNS.some(p => p.test('block component'))).toBe(true);
    expect(UI_BLOCK_PATTERNS.some(p => p.test('insert blocks'))).toBe(true);
    expect(UI_BLOCK_PATTERNS.some(p => p.test('delete block'))).toBe(true);
  });
});

describe('BLOCKING_KEYWORD_PATTERNS', () => {
  it('should extract correct keywords', () => {
    const text = 'This is a blocker blocking the release. blocks deployment. no-go @test-managers hotfix';

    const matchedKeywords = BLOCKING_KEYWORD_PATTERNS
      .filter(p => p.pattern.test(text))
      .map(p => p.keyword);

    expect(matchedKeywords).toContain('blocker');
    expect(matchedKeywords).toContain('blocking');
    expect(matchedKeywords).toContain('blocks');
    expect(matchedKeywords).toContain('no-go');
    expect(matchedKeywords).toContain('test-managers');
    expect(matchedKeywords).toContain('hotfix');
  });
});
