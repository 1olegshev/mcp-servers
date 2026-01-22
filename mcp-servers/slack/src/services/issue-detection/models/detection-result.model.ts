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
