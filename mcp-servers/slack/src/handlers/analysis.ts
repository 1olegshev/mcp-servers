/**
 * Analysis Operations Handler
 * Handles get_blocking_issues, get_auto_test_status, get_release_status_overview
 */

import { BaseHandler } from './base-handler.js';
import { IssueDetectorService } from '../services/issue-detector.js';
import { TestAnalyzerService } from '../services/test-analyzer.js';
import { ReleaseAnalyzerService } from '../services/release-analyzer.js';
import { ToolArgs } from '../types/index.js';

export class AnalysisHandler extends BaseHandler {
  constructor(
    private issueDetector: IssueDetectorService,
    private testAnalyzer: TestAnalyzerService,
    private releaseAnalyzer: ReleaseAnalyzerService
  ) {
    super();
  }

  async getBlockingIssues(args: ToolArgs) {
    this.validateRequired(args, ['date']);
    const channel = args.channel || 'functional-testing';
    const severity = args.severity || 'both';

    try {
      const issues = await this.issueDetector.findIssues(channel, args.date!, severity);
      const report = this.issueDetector.formatIssuesReport(issues, args.date!, channel);

      return this.formatResponse(report);
    } catch (error) {
      this.handleError(error, 'analyze blocking issues');
    }
  }

  async getAutoTestStatus(args: ToolArgs) {
    this.validateRequired(args, ['date']);
    const channel = args.channel || 'functional-testing';

    try {
      const testResults = await this.testAnalyzer.analyzeTestResults(channel, args.date!);
      const report = this.testAnalyzer.formatTestStatusReport(testResults, args.date!);

      return this.formatResponse(report);
    } catch (error) {
      this.handleError(error, 'analyze auto test status');
    }
  }

  async getReleaseStatusOverview(args: ToolArgs) {
    this.validateRequired(args, ['date']);
    const channel = args.channel || 'functional-testing';

    try {
      const overview = await this.releaseAnalyzer.generateReleaseOverview(channel, args.date!);

      return this.formatResponse(overview);
    } catch (error) {
      this.handleError(error, 'generate release status overview');
    }
  }
}
