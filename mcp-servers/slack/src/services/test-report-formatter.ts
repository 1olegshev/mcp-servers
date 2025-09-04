import { TestResult } from '../types/index.js';

export class TestReportFormatter {
  constructor(private parseFailedTestsFromSummary: (summary?: string) => string[]) {}

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
      const allPassed = present.every(t => t.status === 'passed');
      const isResolvedFailure = (t: TestResult): boolean => {
        if (t.status !== 'failed' || !t.hasReview) return false;
        const summary = (t.reviewSummary || '').toLowerCase();
        const notBlocking = summary.includes('not blocking');
        const rerunSuccess = summary.includes('manual rerun successful') || /rerun successful|resolved|fixed/.test(summary);
        return notBlocking || rerunSuccess;
      };
      
            const hasUnderInvestigation = (t: TestResult): boolean => {
        if (t.status !== 'failed' || !t.hasReview) return false;
        const summary = (t.reviewSummary || '').toLowerCase();
        const statusNote = (t.statusNote || '').toLowerCase();
        // Check if any individual test is marked as investigating (with or without emoji)
        const hasInvestigatingTests = t.perTestStatus ? Object.values(t.perTestStatus).some(status => {
          const statusLower = status.toLowerCase();
          // Be more explicit about what we're looking for
          return statusLower.includes('investigating') || 
                 statusLower.includes('🔍') ||
                 statusLower === 'unclear';  // Treat unclear as investigation needed
        }) : false;
        return summary.includes('under investigation') || 
               statusNote.includes('under investigation') ||
               summary.includes('looking into') || 
               statusNote.includes('looking into') ||
               hasInvestigatingTests;
      };
      
      const allResolvedOrPassed = present.every(
        t => t.status === 'passed' || isResolvedFailure(t)
      );
      
      const someUnderInvestigation = present.some(hasUnderInvestigation);
      
      if (allPassed && present.length >= 2) {
        output += `✅ *AUTO TEST STATUS: ALL PASSED*\n`;
      } else if (someUnderInvestigation && present.length >= 1) {
        output += `🔍 *AUTO TEST STATUS: UNDER INVESTIGATION*\n`;
      } else if (allResolvedOrPassed && present.length >= 2) {
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
