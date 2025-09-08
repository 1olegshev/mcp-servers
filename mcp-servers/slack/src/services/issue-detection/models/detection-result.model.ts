/**
 * Result models for issue detection pipeline
 */

import { Issue } from '../../../types/index.js';

export interface DetectionResult {
  issues: Issue[];
  analyzedThreads: number;
  totalMessages: number;
  processingTime: number;
  errors?: string[];
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
  confidence: number; // 0-1 scale
  reasoning: string[];
}
