# Confluence MCP Server

A Model Context Protocol server for interacting with Confluence, focused on QA documentation and article management.

## AI Agent Quick Reference

| What | Where |
|------|-------|
| Entry point | [src/server.ts](src/server.ts) — tool definitions + handlers |
| API client | [src/confluence-client.ts](src/confluence-client.ts) — Axios-based REST client |
| Types | [src/types.ts](src/types.ts) — TypeScript interfaces |
| Build | `npm run build` |
| Tools | 5 read, 4 write (articles/drafts) |

**Write safety**: Updates restricted to QA space. Use `create_qa_draft` for safe testing.

---

## Features

- **Content Search**: Search pages by keywords, author, or CQL
- **Article Reading**: Read full articles with metadata
- **Space Management**: List and navigate Confluence spaces
- **Safe Editing**: Create/update pages with draft support
- **QA Focus**: Default filtering for QA-related content

## Architecture

```
src/
├── server.ts              # MCP server, tool definitions, handlers
├── confluence-client.ts   # Axios-based Confluence REST API client
├── types.ts               # TypeScript interfaces
└── test.ts                # Connection testing utilities
```

### Key Components

| File | Purpose |
|------|---------|
| [server.ts](src/server.ts) | Main MCP server with tool definitions and safety controls |
| [confluence-client.ts](src/confluence-client.ts) | Confluence REST API wrapper using axios |
| [types.ts](src/types.ts) | TypeScript interfaces (ConfluenceConfig, ConfluencePage, ConfluenceSpace) |
| [test.ts](src/test.ts) | Connection verification script |

### Safety Controls

Defined in `server.ts`:

```typescript
// QA-focused defaults
QA_SPACE_KEYS = ['QA', 'TESTING', 'QUALITY', 'TEST']
QA_KEYWORDS = ['qa', 'quality', 'test', 'testing', 'defect', 'bug', 'regression']

// Write restrictions (development safety)
DEVELOPMENT_SPACE = 'QA'
MCP_TESTING_PARENT_ID = '3619127314'  // Safe testing area
ALLOWED_SPACE_FOR_UPDATES = 'QA'
```

## Tools

### Read Operations

#### `find_recent_qa_articles`
Find recent QA-related articles.

**Parameters:**
- `limit`: Max articles to return (default: 10)

#### `read_article`
Read a specific article by ID.

**Parameters:**
- `pageId`: Page ID to read (required)

#### `search_pages`
Search pages by keywords.

**Parameters:**
- `query`: Search query (required)
- `spaceKey`: Optional space filter
- `limit`: Max results (default: 10)

#### `get_spaces`
List available Confluence spaces.

**Parameters:**
- `limit`: Max spaces to return (default: 20)

#### `search_by_author`
Search pages by author name.

**Parameters:**
- `authorName`: Author to search for (required)
- `limit`: Max results (default: 10)

### Write Operations

#### `update_article`
Update an existing article with draft/publish options.

**Parameters:**
- `pageId`: Page ID to update (required)
- `newContent`: New content in Confluence storage format (required)
- `publish`: Publish immediately (default: false, saves as draft)

#### `preview_changes`
Preview changes before applying.

**Parameters:**
- `pageId`: Page ID (required)
- `newContent`: Proposed content (required)

#### `create_qa_draft`
Create a QA article draft in the safe testing space.

**Parameters:**
- `title`: Article title (required)
- `content`: Article content (required)

#### `create_article`
Create a new article in any space.

**Parameters:**
- `spaceKey`: Target space key (required)
- `title`: Article title (required)
- `content`: Article content (required)
- `parentId`: Optional parent page ID

## CLI Testing

### Setup
```bash
# From project root
export $(grep -v '^#' .env | grep -v '^$' | xargs)
```

### Build
```bash
cd mcp-servers/confluence && npm run build && cd ../..
```

### Test Commands

**List tools:**
```bash
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | node mcp-servers/confluence/dist/server.js 2>/dev/null | jq '.result.tools[].name'
```

**List spaces:**
```bash
echo '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_spaces","arguments":{}}}' | node mcp-servers/confluence/dist/server.js 2>/dev/null
```

**Search pages:**
```bash
echo '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"search_pages","arguments":{"query":"testing"}}}' | node mcp-servers/confluence/dist/server.js 2>/dev/null
```

**Find recent QA articles:**
```bash
echo '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"find_recent_qa_articles","arguments":{"limit":5}}}' | node mcp-servers/confluence/dist/server.js 2>/dev/null
```

**Read specific article:**
```bash
echo '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"read_article","arguments":{"pageId":"123456789"}}}' | node mcp-servers/confluence/dist/server.js 2>/dev/null
```

### Connection Test
```bash
cd mcp-servers/confluence && npm run test
```

### One-liner (list spaces)
```bash
# From project root
export $(grep -v '^#' .env | grep -v '^$' | xargs) && echo '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_spaces","arguments":{}}}' | node mcp-servers/confluence/dist/server.js 2>/dev/null | jq -r '.result.content[0].text'
```

## Configuration

### Environment Variables
```bash
CONFLUENCE_BASE_URL=https://yourorg.atlassian.net
CONFLUENCE_EMAIL=your-email@company.com
CONFLUENCE_API_TOKEN=your-api-token
```

### Get API Token
1. Go to https://id.atlassian.com/manage-profile/security/api-tokens
2. Create new API token
3. Copy to `.env` as `CONFLUENCE_API_TOKEN`

## Content Format

Confluence uses **storage format** for content (XHTML-like):

```html
<p>Paragraph text</p>
<h1>Heading 1</h1>
<ac:structured-macro ac:name="code">
  <ac:plain-text-body><![CDATA[code here]]></ac:plain-text-body>
</ac:structured-macro>
```

When updating content, preserve the storage format or convert from markdown.

## CQL (Confluence Query Language)

The server uses CQL for searches. Examples:

```
# Find by title
title ~ "testing"

# Find by space
space = "QA"

# Find by author
creator = "john.doe"

# Combined
space = "QA" AND title ~ "release" AND type = page
```

## Troubleshooting

| Error | Fix |
|-------|-----|
| `Missing Confluence configuration` | Set CONFLUENCE_BASE_URL, CONFLUENCE_EMAIL, CONFLUENCE_API_TOKEN in .env |
| `Search failed` | Check CQL syntax, verify space exists |
| `401 Unauthorized` | API token expired or invalid |
| `Page not found` | Verify page ID, check access permissions |
| `Update failed` | Check write permissions, verify version number |

## Known Limitations

- Write operations restricted to QA space for safety
- Content format must be Confluence storage format (not markdown)
