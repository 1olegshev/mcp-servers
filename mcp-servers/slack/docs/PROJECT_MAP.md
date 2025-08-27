# Project Map - Complete Overview

## 🗺️ High-Level Project Map

```
📦 Slack MCP Server
├── 🎯 Purpose: Release Management & QA Coordination via Slack
├── 🏗️ Architecture: Clean, Modular, Testable
└── 🔧 Technology: TypeScript + MCP + Slack Web API
```

## 📁 File Structure with Responsibilities

```
slack-mcp-server/
│
├── 📜 Configuration Files
│   ├── package.json           # Dependencies & scripts
│   ├── tsconfig.json          # TypeScript config
│   └── .env                   # Environment variables (not in repo)
│
├── 📚 Documentation
│   ├── README.md              # Basic setup instructions
│   ├── AI_AGENT_GUIDE.md      # 📖 Comprehensive AI guide (THIS FILE)
│   ├── QUICK_REFERENCE.md     # 🚀 Common operations cheat sheet
│   ├── TYPE_SYSTEM.md         # 📋 Complete type documentation
│   ├── REFACTORING_SUMMARY.md # 📊 Before/after comparison
│   └── SECURITY.md            # Security considerations
│
└── 💻 Source Code (src/)
    │
    ├── 🚀 server.ts                    # Main orchestrator & entry point
    │   ├── Dependencies: All handlers, services, auth
    │   ├── Responsibility: Tool routing, service initialization
    │   └── Size: ~180 lines (clean & focused)
    │
    ├── 🔐 auth/
    │   └── slack-auth.ts               # Authentication management
    │       ├── Pattern: Singleton
    │       ├── Handles: XOXC/XOXD session auth
    │       └── Security: Write access restrictions
    │
    ├── 🌐 clients/
    │   └── slack-client.ts             # Slack API wrapper
    │       ├── Dependencies: SlackAuth, SlackResolver
    │       ├── Responsibility: Clean Slack API interface
    │       └── Features: Error handling, type conversion
    │
    ├── 🏢 services/ (Business Logic Layer)
    │   ├── issue-detector.ts           # Find blocking/critical issues
    │   │   ├── Input: Channel messages
    │   │   ├── Processing: Text analysis, thread checking
    │   │   └── Output: Structured issue reports
    │   │
    │   ├── test-analyzer.ts            # Analyze auto test results
    │   │   ├── Input: Bot messages from channels
    │   │   ├── Processing: Test status detection, review analysis
    │   │   └── Output: Test status summaries
    │   │
    │   └── release-analyzer.ts         # Release readiness decisions
    │       ├── Dependencies: IssueDetector, TestAnalyzer
    │       ├── Processing: Combines all analysis
    │       └── Output: "Can we release?" recommendations
    │
    ├── 🎛️ handlers/ (MCP Interface Layer)
    │   ├── base-handler.ts             # Common patterns
    │   │   ├── Pattern: Template method
    │   │   ├── Provides: Error handling, validation, formatting
    │   │   └── Used by: All other handlers
    │   │
    │   ├── messaging.ts                # Communication tools
    │   │   ├── Tools: send_message, list_channels, get_channel_history,
    │   │   │         search_messages, add_reaction, get_thread_replies
    │   │   ├── Features: Channel resolution, user mapping
    │   │   └── Validation: Write access control
    │   │
    │   └── analysis.ts                 # Analysis tools
    │       ├── Tools: get_blocking_issues, get_auto_test_status,
    │       │         get_release_status_overview
    │       ├── Integration: Orchestrates service calls
    │       └── Output: Formatted analysis reports
    │
    ├── 🛠️ utils/ (Shared Utilities)
    │   ├── resolvers.ts                # Channel/user ID resolution
    │   │   ├── Supports: #channel, @user, IDs, etc.
    │   │   ├── Features: Caching, pagination
    │   │   └── Performance: User lookup caching
    │   │
    │   ├── analyzers.ts                # Text analysis functions
    │   │   ├── Features: JIRA ticket extraction, severity analysis
    │   │   ├── Patterns: Bot detection, test result parsing
    │   │   └── Business rules: Release management keywords
    │   │
    │   └── date-utils.ts               # Date handling utilities
    │       ├── Formats: YYYY-MM-DD ↔ Unix timestamps
    │       ├── Features: Date range calculation
    │       └── Display: Human-readable formatting
    │
    └── 📋 types/
        └── index.ts                    # TypeScript definitions
            ├── ToolArgs: MCP tool parameters
            ├── SlackMessage: Message structure
            ├── Analysis types: Issues, TestResults
            └── Workspace types: Channels, Users
```

## 🔄 Data Flow Overview

### 1. **Request Processing Flow**
```
External MCP Client
       ↓
📱 server.ts (routes to handler)
       ↓
🎛️ Handler (validates & processes)
       ↓
🏢 Service (business logic)
       ↓
🌐 Client (API wrapper)
       ↓
🔐 Auth (authentication)
       ↓
Slack API
```

### 2. **Authentication Flow**
```
Environment Variables → SlackAuth (singleton) → WebClient → All API calls
```

### 3. **Analysis Pipeline**
```
Channel Messages → Text Analysis → Pattern Detection → Business Logic → Report
```

## 🎯 9 Available Tools

### 💬 **Messaging Tools** (6)
1. **send_message** - Send messages (restricted to qa-release-status)
2. **list_channels** - List workspace channels
3. **get_channel_history** - Get recent messages
4. **search_messages** - Search across workspace
5. **add_reaction** - Add emoji reactions
6. **get_thread_replies** - Get thread responses

### 📊 **Analysis Tools** (3)
7. **get_blocking_issues** - Find critical/blocking issues
8. **get_auto_test_status** - Analyze test results
9. **get_release_status_overview** - Complete release decision

## 🔧 Key Design Patterns

### 🏛️ **Architectural Patterns**
- **Layered Architecture**: Clear separation of concerns
- **Dependency Injection**: Services injected into handlers
- **Singleton**: Authentication state management
- **Factory**: Client creation based on available auth
- **Template Method**: Base handler for common operations

### 🛡️ **Error Handling Strategy**
- **Consistent**: All handlers extend BaseHandler
- **Typed**: McpError for MCP compatibility
- **Contextual**: Operation-specific error messages
- **Graceful**: Fallbacks for non-critical failures

### ⚡ **Performance Optimizations**
- **Caching**: User lookups cached in resolver
- **Pagination**: Large result sets handled efficiently
- **Limiting**: Default limits on message queries
- **Lazy Loading**: Services initialized only when needed

## 🚨 Critical Business Rules

### 🔒 **Security Constraints**
- **Write Restriction**: Only qa-release-status channel
- **Authentication**: Session-based (XOXC/XOXD) preferred
- **Validation**: All inputs validated at handler level
- **Audit Trail**: All actions logged under token owner

### 📊 **Analysis Logic**
- **Blocking Issues**: Keywords like "blocker", "blocking", "release blocker"
- **Critical Issues**: Keywords like "critical", "urgent", "high priority"
- **Test Bots**: Identified by automation-related usernames/content
- **Review Status**: Thread analysis for manual review completion

### 📅 **Date Handling**
- **Format**: YYYY-MM-DD for user input
- **Range**: Full day analysis (00:00:00 to 23:59:59)
- **Default**: Today if no date specified
- **Timezone**: Server timezone (should be documented)

## 🧪 Testing Strategy

### 🎯 **What to Test**
- **Services**: Business logic with mocked SlackClient
- **Handlers**: Tool interfaces with mocked services
- **Utils**: Pure functions (analyzers, date utils)
- **Integration**: End-to-end tool execution

### 🔧 **Testing Patterns**
- **Mock External Dependencies**: Slack API calls
- **Validate Business Logic**: Analysis algorithms
- **Test Error Handling**: Invalid inputs, API failures
- **Verify Security**: Write access restrictions

## 🚀 Development Workflow

### 📝 **Common Tasks**
1. **Adding Tools**: Schema → Route → Handler → Service (if needed)
2. **Modifying Analysis**: Update analyzers → Service logic → Handler
3. **New Integrations**: Create service → Inject dependencies → Add tools
4. **Bug Fixes**: Identify layer → Fix in appropriate module → Test

### 🔄 **Build & Deploy**
```bash
npm run build    # Compile TypeScript
npm start        # Run production server
npm run dev      # Development with auto-rebuild
```

## 📈 Future Extensibility

### ✅ **Easy to Add**
- New analysis patterns (add to analyzers.ts)
- New Slack operations (add to slack-client.ts)
- New tools (schema + handler + service)
- New report formats (modify service formatters)

### 🎯 **Architecture Supports**
- Multiple authentication methods
- Different message sources (not just Slack)
- Various analysis algorithms
- Different output formats
- Multiple business domains

This project map provides AI agents with a complete mental model of the codebase structure, responsibilities, and interactions! 🎯