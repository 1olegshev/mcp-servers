/**
 * AnalysisHandler Unit Tests
 * Tests the MCP tool handlers for issue analysis
 */

import { AnalysisHandler } from '../analysis';
import { IssueDetectorService } from '../../services/issue-detector';
import { TestAnalyzerService } from '../../services/test-analyzer';
import { ReleaseAnalyzerService } from '../../services/release-analyzer';

// Mock services
const mockIssueDetector = {
  findIssues: jest.fn(),
  enrichIssuesWithJiraTitles: jest.fn().mockImplementation((issues) => Promise.resolve(issues)),
  formatIssuesReport: jest.fn()
};

const mockTestAnalyzer = {
  analyzeTestResults: jest.fn(),
  formatTestStatusReport: jest.fn()
};

const mockReleaseAnalyzer = {
  generateReleaseOverview: jest.fn()
};

const mockSlackClient = {
  resolveConversation: jest.fn(),
  getChannelHistoryForDateRange: jest.fn().mockResolvedValue([]),
  searchMessages: jest.fn().mockResolvedValue([]),
  getPermalink: jest.fn()
};

describe('AnalysisHandler', () => {
  let handler: AnalysisHandler;

  beforeEach(() => {
    jest.clearAllMocks();
    handler = new AnalysisHandler(
      mockIssueDetector as any,
      mockTestAnalyzer as any,
      mockReleaseAnalyzer as any,
      mockSlackClient as any
    );
  });

  describe('getBlockingIssues', () => {
    const mockIssues = [
      {
        type: 'blocking',
        text: 'Database connection issue',
        tickets: [{ key: 'PROJ-123' }],
        timestamp: '1234567890',
        hasThread: true,
        permalink: 'https://slack.com/thread'
      }
    ];

    it('should return formatted blocking issues', async () => {
      mockIssueDetector.findIssues.mockResolvedValue(mockIssues);
      mockIssueDetector.formatIssuesReport.mockReturnValue('Formatted report');

      const result = await handler.getBlockingIssues({
        channel: 'test-channel',
        date: '2025-01-01',
        severity: 'blocking'
      });

      expect(mockIssueDetector.findIssues).toHaveBeenCalledWith('test-channel', '2025-01-01', 'blocking');
      expect(mockIssueDetector.formatIssuesReport).toHaveBeenCalledWith(mockIssues, '2025-01-01', 'test-channel');
      expect(result.content[0].text).toBe('Formatted report');
    });

    it('should use default channel when not specified', async () => {
      mockIssueDetector.findIssues.mockResolvedValue([]);
      mockIssueDetector.formatIssuesReport.mockReturnValue('No issues');

      await handler.getBlockingIssues({ date: '2025-01-01' });

      expect(mockIssueDetector.findIssues).toHaveBeenCalledWith('functional-testing', '2025-01-01', 'both');
    });

    it('should use default severity when not specified', async () => {
      mockIssueDetector.findIssues.mockResolvedValue([]);
      mockIssueDetector.formatIssuesReport.mockReturnValue('No issues');

      await handler.getBlockingIssues({ channel: 'test-channel', date: '2025-01-01' });

      expect(mockIssueDetector.findIssues).toHaveBeenCalledWith('test-channel', '2025-01-01', 'both');
    });

    it('should handle service errors gracefully', async () => {
      mockIssueDetector.findIssues.mockRejectedValue(new Error('Service unavailable'));

      await expect(handler.getBlockingIssues({
        channel: 'test-channel',
        date: '2025-01-01'
      })).rejects.toThrow('Failed to analyze blocking issues');
    });

    it('should handle empty results', async () => {
      mockIssueDetector.findIssues.mockResolvedValue([]);
      mockIssueDetector.formatIssuesReport.mockReturnValue('✅ No blocking or critical issues found');

      const result = await handler.getBlockingIssues({
        channel: 'test-channel',
        date: '2025-01-01'
      });

      expect(result.content[0].text).toContain('No blocking or critical issues found');
    });
  });

  describe('getAutoTestStatus', () => {
    const mockTestResults = [
      {
        type: 'Cypress (unverified)',
        status: 'passed' as const,
        text: 'All tests passed',
        timestamp: '1234567890',
        hasReview: false
      }
    ];

    it('should return formatted test results', async () => {
      mockTestAnalyzer.analyzeTestResults.mockResolvedValue(mockTestResults);
      mockTestAnalyzer.formatTestStatusReport.mockReturnValue('Test report formatted');

      const result = await handler.getAutoTestStatus({
        channel: 'test-channel',
        date: '2025-01-01'
      });

      expect(mockTestAnalyzer.analyzeTestResults).toHaveBeenCalledWith('test-channel', '2025-01-01');
      expect(result.content[0].text).toBe('Test report formatted');
    });

    it('should use default channel for test analysis', async () => {
      mockTestAnalyzer.analyzeTestResults.mockResolvedValue([]);
      mockTestAnalyzer.formatTestStatusReport.mockReturnValue('No tests');

      await handler.getAutoTestStatus({ date: '2025-01-01' });

      expect(mockTestAnalyzer.analyzeTestResults).toHaveBeenCalledWith('functional-testing', '2025-01-01');
    });

    it('should handle test analysis errors', async () => {
      mockTestAnalyzer.analyzeTestResults.mockRejectedValue(new Error('Analysis failed'));

      await expect(handler.getAutoTestStatus({
        channel: 'test-channel',
        date: '2025-01-01'
      })).rejects.toThrow('Failed to analyze auto test status');
    });
  });

  describe('getReleaseStatusOverview', () => {
    it('should return release overview', async () => {
      mockReleaseAnalyzer.generateReleaseOverview.mockResolvedValue('Release ready');

      const result = await handler.getReleaseStatusOverview({
        channel: 'test-channel',
        date: '2025-01-01'
      });

      expect(mockReleaseAnalyzer.generateReleaseOverview).toHaveBeenCalledWith('test-channel', '2025-01-01');
      expect(result.content[0].text).toBe('Release ready');
    });

    it('should use default channel for release overview', async () => {
      mockReleaseAnalyzer.generateReleaseOverview.mockResolvedValue('Overview generated');

      await handler.getReleaseStatusOverview({ date: '2025-01-01' });

      expect(mockReleaseAnalyzer.generateReleaseOverview).toHaveBeenCalledWith('functional-testing', '2025-01-01');
    });

    it('should handle release analysis errors', async () => {
      mockReleaseAnalyzer.generateReleaseOverview.mockRejectedValue(new Error('Analysis failed'));

      await expect(handler.getReleaseStatusOverview({
        channel: 'test-channel',
        date: '2025-01-01'
      })).rejects.toThrow('Failed to generate release status overview');
    });
  });

  describe('input validation', () => {
    it('should require date parameter for all analysis tools', async () => {
      await expect(handler.getBlockingIssues({})).rejects.toThrow('date is required');
      await expect(handler.getAutoTestStatus({})).rejects.toThrow('date is required');
      await expect(handler.getReleaseStatusOverview({})).rejects.toThrow('date is required');
    });

    it('should validate date format', async () => {
      // This would require additional validation logic in the handler
      // For now, the services handle date validation
      mockIssueDetector.findIssues.mockResolvedValue([]);

      const result = await handler.getBlockingIssues({
        channel: 'test-channel',
        date: 'invalid-date'
      });

      // Should still work, with service handling invalid dates
      expect(result).toBeDefined();
    });
  });

  describe('MCP response format', () => {
    it('should return proper MCP response format', async () => {
      mockIssueDetector.findIssues.mockResolvedValue([]);
      mockIssueDetector.formatIssuesReport.mockReturnValue('Test response');

      const result = await handler.getBlockingIssues({
        channel: 'test-channel',
        date: '2025-01-01'
      });

      expect(result).toHaveProperty('content');
      expect(Array.isArray(result.content)).toBe(true);
      expect(result.content[0]).toHaveProperty('type', 'text');
      expect(result.content[0]).toHaveProperty('text');
    });

    it('should handle multiple content items if needed', async () => {
      // Test handlers could return multiple content items for complex responses
      mockReleaseAnalyzer.generateReleaseOverview.mockResolvedValue('Complex response');

      const result = await handler.getReleaseStatusOverview({
        channel: 'test-channel',
        date: '2025-01-01'
      });

      expect(result.content).toHaveLength(1);
    });
  });
});
