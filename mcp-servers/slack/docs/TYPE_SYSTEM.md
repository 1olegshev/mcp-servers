# Type System Overview

## 🏗️ Core Types Architecture

This document maps out the type system to help AI agents understand data flow and interfaces.

## 📋 Main Type Definitions (`types/index.ts`)

### 🔧 Tool Arguments
```typescript
interface ToolArgs {
  // Common parameters
  channel?: string;           // Channel ID, #name, @user, etc.
  text?: string;             // Message text content
  thread_ts?: string;        // Thread timestamp for replies
  limit?: number;            // Result limit (default varies by tool)
  
  // User/Display options
  resolve_users?: boolean;   // Convert user IDs to display names
  query?: string;            // Search query string
  
  // Message operations
  timestamp?: string;        // Message timestamp for reactions
  name?: string;             // Emoji name for reactions
  types?: string;            // Channel types filter
  
  // Analysis parameters
  date?: string;             // Date for analysis (YYYY-MM-DD)
  severity?: 'blocking' | 'critical' | 'both';  // Issue severity filter
}
```

### 💬 Slack Message Types
```typescript
interface SlackMessage {
  user?: string;             // User ID who sent message
  text?: string;             // Message text content
  ts?: string;               // Message timestamp (Unix decimal)
  thread_ts?: string;        // Parent message timestamp if in thread
  reply_count?: number;      // Number of replies in thread
  username?: string;         // Bot username (for bot messages)
  bot_profile?: {            // Bot profile information
    name?: string;
  };
}

interface FormattedMessage {
  user: string;              // User ID or display name (resolved)
  text: string;              // Message text
  timestamp: string;         // Formatted timestamp
  thread_ts?: string;        // Thread parent timestamp
}
```

### 🔍 Analysis Result Types
```typescript
interface Issue {
  type: 'blocking' | 'critical' | 'blocking_resolved';  // Issue severity level
  text: string;                   // Issue description (truncated)
  tickets: JiraTicketInfo[];      // Extracted JIRA ticket info with URLs
  timestamp: string;              // When issue was reported
  hasThread: boolean;             // Whether issue has thread discussion
  resolutionText?: string;        // Resolution details for resolved blockers
  permalink?: string;             // Direct link to Slack message/thread
}

interface JiraTicketInfo {
  key: string;                    // e.g., "PROJ-123"
  url?: string;                   // Full URL to ticket in Jira
  project?: string;               // Project key (e.g., "PROJ")
  labels?: string[];              // Issue labels
  components?: string[];          // Issue components
  status?: string;                // Current status
  priority?: string;              // Priority level
}

interface TestResult {
  type: string;                   // Test type (e.g., "Cypress Unverified")
  status: 'passed' | 'failed' | 'pending';  // Test execution status
  text: string;                   // Test result message (truncated)
  timestamp: string;              // When test was run
  hasReview: boolean;             // Whether failure has been reviewed
  reviewSummary?: string;         // Review status description
}
```

### 🏢 Workspace Types
```typescript
interface Channel {
  id: string;                // Channel ID (C123456789)
  name: string;              // Channel name (without #)
  topic: string;             // Channel topic
  purpose: string;           // Channel purpose
  num_members?: number;      // Member count (if available)
}

interface UserInfo {
  id: string;                // User ID (U123456789)
  name?: string;             // Username handle
  real_name?: string;        // Full real name
  profile?: {
    display_name?: string;   // Preferred display name
  };
}
```

## 🔄 Data Flow Type Mappings

### 1. **Tool Input → Service Processing**
```
ToolArgs → SlackMessage[] → Analysis Results → Formatted Response
```

### 2. **Channel Resolution Flow**
```
string (#channel/@user/ID) → SlackResolver → string (conversation ID)
```

### 3. **Authentication Flow**
```
Environment Variables → SlackAuth → WebClient → Slack API Types
```

## 🎛️ Handler Type Patterns

### 📨 Messaging Handler Types
```typescript
// Input validation
interface MessageArgs extends ToolArgs {
  channel: string;    // Required
  text: string;       // Required
  thread_ts?: string; // Optional
}

// Response format
interface McpResponse {
  content: Array<{
    type: 'text';
    text: string;
  }>;
}
```

### 📊 Analysis Handler Types
```typescript
// Issue analysis input
interface IssueAnalysisArgs extends ToolArgs {
  channel?: string;   // Default: 'functional-testing'
  date?: string;      // Default: today (YYYY-MM-DD)
  severity?: 'blocking' | 'critical' | 'both';  // Default: 'both'
}

// Test analysis input  
interface TestAnalysisArgs extends ToolArgs {
  channel?: string;   // Default: 'functional-testing'
  date?: string;      // Default: today (YYYY-MM-DD)
}
```

## 🔐 Authentication Types

### 🎫 Token Types
```typescript
// Environment variables (string | undefined)
SLACK_MCP_XOXC_TOKEN  // Session bearer token (xoxc-...)
SLACK_MCP_XOXD_TOKEN  // Session cookie value (xoxd-...)
SLACK_BOT_TOKEN       // Fallback bot token (xoxb-...)

// WebClient configuration
interface ClientConfig {
  headers: {
    Cookie: string;   // Format: "d=<xoxd_token>; d-s="
  };
}
```

## 🛠️ Utility Type Patterns

### 📅 Date Utilities
```typescript
// Input/Output types
type DateString = string;      // Format: "YYYY-MM-DD"
type UnixTimestamp = string;   // Format: "1234567890.123"

interface DateRange {
  oldest: UnixTimestamp;       // Start of day (00:00:00)
  latest: UnixTimestamp;       // End of day (23:59:59)
}
```

### 🕵️ Text Analysis Types
```typescript
// Pattern analysis results
interface SeverityAnalysis {
  isBlocking: boolean;
  isCritical: boolean;
}

interface TestAnalysis {
  testType: string;            // 'Cypress Unverified' | 'Cypress General' | 'Playwright' | 'unknown'
  status: 'passed' | 'failed' | 'pending';
}

// Pattern extraction
type JiraTickets = string[];   // Array of "PROJ-123" format tickets
```

## 🌐 Slack API Type Integration

### 📡 API Response Types (from @slack/web-api)
```typescript
// Import from Slack SDK
import { 
  ConversationsHistoryResponse,
  ConversationsListResponse,
  UsersListResponse 
} from '@slack/web-api';

// Extended with pagination
interface PaginatedResponse {
  response_metadata?: {
    next_cursor?: string;
  };
}
```

### 🔄 Type Conversion Patterns
```typescript
// Slack API → Internal Types
SlackMessage[] = ConversationsHistoryResponse.messages as SlackMessage[]

// Internal → MCP Response
McpResponse = { content: [{ type: 'text', text: string }] }

// Channel Resolution
string → ConversationID: await slackClient.resolveConversation(input)
```

## 🎯 Business Logic Type Constraints

### 🚨 Validation Rules
```typescript
// Required field validation
ToolArgs['channel'] !== undefined  // For messaging operations
ToolArgs['text'] !== undefined     // For send_message

// Write access validation  
channel in ['qa-release-status', '#qa-release-status', 'C09BW9Y2HSN']

// Date format validation
date.match(/^\d{4}-\d{2}-\d{2}$/)  // YYYY-MM-DD format
```

### 📊 Analysis Type Rules
```typescript
// Issue severity mapping
'blocker' | 'blocking' | 'release blocker' → type: 'blocking'
'critical' | 'urgent' | 'high priority' → type: 'critical'
'resolved' | 'fixed' | 'ready' | 'deployed' → type: 'blocking_resolved'

// Thread detection from permalinks
permalink.match(/[?&]thread_ts=([^&]+)/) → thread timestamp extraction

// Test bot identification
username.includes('cypress' | 'playwright' | 'test' | 'automation')

// Review status determination
replies.includes('reviewed' | 'not blocking' | 'approved') → hasReview: true

// Resolution pattern detection
text.includes('resolved' | 'fixed' | 'ready' | 'deployed') → resolution detected
```

## 🧪 Testing Type Patterns

### 🎭 Mock Types
```typescript
// Service mocks
interface MockSlackClient {
  getChannelHistory: jest.Mock<Promise<SlackMessage[]>>;
  sendMessage: jest.Mock<Promise<{ts: string}>>;
  resolveConversation: jest.Mock<Promise<string>>;
}

// Handler test types
interface TestResult {
  content: Array<{
    type: 'text';
    text: string;
  }>;
}
```

This type system documentation helps AI agents understand how data flows through the system and what types to expect at each layer!