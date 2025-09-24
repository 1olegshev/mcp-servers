/**
 * Type definitions for Slack MCP Server
 */

export interface ToolArgs {
  channel?: string;
  text?: string;
  thread_ts?: string;
  limit?: number;
  resolve_users?: boolean;
  query?: string;
  timestamp?: string;
  name?: string;
  types?: string;
  date?: string;
  severity?: 'blocking' | 'critical' | 'both';
}

export interface SlackMessage {
  user?: string;
  text?: string;
  ts?: string;
  thread_ts?: string;
  reply_count?: number;
  username?: string;
  bot_id?: string;
  bot_profile?: {
    name?: string;
    id?: string;
  };
  blocks?: any[];
  attachments?: any[];
  reactions?: { name: string; count: number; users: string[] }[];
}

export interface FormattedMessage {
  user: string;
  text: string;
  timestamp: string;
  thread_ts?: string;
}

export interface Issue {
  type: 'blocking' | 'critical' | 'blocking_resolved';
  text: string;
  tickets: JiraTicketInfo[];
  timestamp: string;
  hasThread: boolean;
  resolutionText?: string; // Add field for resolution context
  permalink?: string; // Slack permalink to parent message/thread
  hotfixCommitment?: boolean;
}

export interface JiraTicketInfo {
  key: string;                    // e.g., "PROJ-123"
  url?: string;                   // Full URL to ticket
  project?: string;               // Project key
  labels?: string[];              // Issue labels
  components?: string[];          // Issue components
  status?: string;                // Current status
  priority?: string;              // Priority level
}

export interface TestResult {
  type: string;
  status: 'passed' | 'failed' | 'pending';
  text: string;
  timestamp: string;
  hasReview: boolean;
  reviewSummary?: string;
  permalink?: string;
  // Structured fields to avoid parsing brittle text
  failedTests?: string[];      // Extracted from thread/content
  statusNote?: string;         // Resolution/status note without the failed-tests prefix
  perTestStatus?: Record<string, string>; // Map of normalized test name -> status note
  sectionSummary?: string;     // Section-level status computed by thread analyzer
}

export interface Channel {
  id: string;
  name: string;
  topic: string;
  purpose: string;
  num_members?: number;
}

export interface UserInfo {
  id: string;
  name?: string;
  real_name?: string;
  profile?: {
    display_name?: string;
  };
}