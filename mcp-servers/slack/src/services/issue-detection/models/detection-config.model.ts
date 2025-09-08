/**
 * Configuration models for issue detection pipeline
 */

export interface DetectionConfig {
  channel: string;
  date: string;
  severity: 'blocking' | 'critical' | 'both';
  includeResolved: boolean;
  maxThreads?: number;
  maxMessages?: number;
}

export interface PatternConfig {
  blockingKeywords: string[];
  criticalKeywords: string[];
  resolutionKeywords: string[];
  ticketPattern: RegExp;
}

export interface AnalysisOptions {
  includeBotMessages: boolean;
  maxThreadDepth: number;
  prioritizeThreadContext: boolean;
}
