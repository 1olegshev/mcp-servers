/**
 * Data models for ticket context and analysis results
 */

import { JiraTicketInfo } from '../../../types/index.js';

export interface TicketContext {
  key: string;
  url?: string;
  project?: string;
  threadLink?: string;
  sourceText?: string;
  timestamp?: string;
  hasThread?: boolean;
}

export interface DetectionResult {
  issues: any[]; // Will be Issue[] after we create the pipeline
  analyzedThreads: number;
  totalMessages: number;
  processingTime: number;
}

export interface ThreadAnalysisResult {
  ticketKey: string;
  isBlocking: boolean;
  isResolved: boolean;
  contextText: string;
  resolutionText?: string;
}

export interface BlockingAnalysis {
  isBlocking: boolean;
  isResolved: boolean;
}
