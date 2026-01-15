import { TestResult } from '../types/index.js';
import { ThreadAnalyzerService } from './thread-analyzer.js';

export class TestReportFormatter {
  constructor(
    private parseFailedTestsFromSummary: (summary?: string) => string[],
    private threadAnalyzer: ThreadAnalyzerService
  ) {}

  format(testResults: TestResult[], getTestTypeFromMessage: (t: TestResult) => string, date?: string): string {
    let output = `🔬 Latest Test Results:\n`;

    const expectedSuites = ['Cypress (general)', 'Cypress (unverified)', 'Playwright'] as const;
    const latestByType = this.getLatestByType(testResults, getTestTypeFromMessage);

    for (const suite of expectedSuites) {
      const test = latestByType.get(suite);
      if (test) {
        if (test.status === 'passed') {
          if (test.permalink) {
            output += `• <${test.permalink}|*${suite}*>: ✅\n`;
            output += `  All tests passed\n`;
          } else {
            output += `• *${suite}*: ✅\n`;
            output += `  All tests passed\n`;
          }
        } else {
          const statusDisplay = test.status === 'failed' ? '❌' : '⏳';
          if (test.permalink) {
            output += `• <${test.permalink}|*${suite}*>: ${statusDisplay}\n`;
          } else {
            output += `• *${suite}*: ${statusDisplay}\n`;
          }
        }
        if (test.status === 'failed') {
          const failedTests = (
            (test.failedTests && test.failedTests.length > 0)
              ? test.failedTests
              : this.parseFailedTestsFromSummary(test.reviewSummary)
          ).slice(0, 6);
          
          for (const testName of failedTests) {
            let display = testName
              .replace(/\.(test|spec)\.[jt]sx?$/i, '')
              .replace(/\.[jt]sx?$/i, '')
              .replace(/[.,…\s]+$/g, '');
            
            // Try to find status with flexible matching
            let status = '';
            if (test.perTestStatus) {
              // First try exact match
              if (test.perTestStatus[display]) {
                status = test.perTestStatus[display];
              } else {
                // Try partial matching for flexible test name variations
                const statusKeys = Object.keys(test.perTestStatus);
                const matchingKey = statusKeys.find(key => 
                  key.includes(display) || display.includes(key) ||
                  key.replace(/_/g, '-') === display.replace(/_/g, '-')
                );
                if (matchingKey) {
                  status = test.perTestStatus[matchingKey];
                }
              }
            }
            
            const note = ` — ${status || 'unclear'}`;
            output += `  • *${display}*${note}\n`;
          }
          // Use section summary from thread analyzer
          output += `  └─ ${test.sectionSummary || '⏳ Awaiting review'}\n`;
        }
      } else {
        output += `• *${suite}*: ❓ No recent results\n`;
      }
      output += '\n';
    }

    const present = expectedSuites
      .map(s => latestByType.get(s))
      .filter((t): t is TestResult => !!t);

    if (present.length === 0) {
      output += `❓ *AUTO TEST STATUS: NO RECENT RESULTS*\n`;
    } else {
      // Simple verdict based on per-suite sectionSummary
      const allPassed = present.every(t => t.status === 'passed');

      const suiteNeedsAttention = (t: TestResult): boolean => {
        if (t.status === 'passed') return false;
        const summary = (t.sectionSummary || '').toLowerCase();
        return summary.includes('⚠️') || summary.includes('🚫') || summary.includes('needs attention') || summary.includes('blocker');
      };

      const suiteCleared = (t: TestResult): boolean => {
        if (t.status === 'passed') return true;
        const summary = (t.sectionSummary || '').toLowerCase();
        return summary.includes('✅') || summary.includes('not blocking');
      };

      const anyNeedsAttention = present.some(suiteNeedsAttention);
      const allCleared = present.every(suiteCleared);

      if (allPassed) {
        output += `✅ *AUTO TEST STATUS: ALL PASSED*\n`;
      } else if (anyNeedsAttention) {
        output += `⚠️ *AUTO TEST STATUS: ATTENTION REQUIRED*\n`;
      } else if (allCleared) {
        output += `✅ *AUTO TEST STATUS: RESOLVED - NOT BLOCKING*\n`;
      } else {
        output += `⚠️ *AUTO TEST STATUS: ATTENTION REQUIRED*\n`;
      }
    }

    return output;
  }

  private getLatestByType(testResults: TestResult[], getTestTypeFromMessage: (t: TestResult) => string): Map<string, TestResult> {
    const byType = new Map<string, TestResult>();
    testResults
      .slice()
      .sort((a, b) => parseFloat(b.timestamp) - parseFloat(a.timestamp))
      .forEach(result => {
        const key = getTestTypeFromMessage(result);
        if ((key === 'Cypress (general)' || key === 'Cypress (unverified)' || key === 'Playwright') && !byType.has(key)) {
          byType.set(key, result);
        }
      });
    return byType;
  }

}
