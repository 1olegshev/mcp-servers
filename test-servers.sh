#!/bin/bash

# Test MCP Servers Script

echo "🧪 Testing MCP Servers..."

# Check if .env file exists
if [ ! -f .env ]; then
    echo "❌ .env file not found. Please copy env.example to .env and fill in your credentials."
    exit 1
fi

echo "✅ .env file found"

# Load environment variables
export $(grep -v '^#' .env | xargs)

# Test Slack MCP Server
echo "Testing Slack MCP Server..."
if [ -n "$SLACK_BOT_TOKEN" ] && [ -n "$SLACK_APP_TOKEN" ]; then
    echo "✅ Slack credentials configured"
    echo "To test Slack server: cd mcp-servers/slack && node server.js"
else
    echo "⚠️  Slack credentials not configured"
fi

# Test Jira MCP Server
echo "Testing Jira MCP Server..."
if [ -n "$JIRA_BASE_URL" ] && [ -n "$JIRA_EMAIL" ] && [ -n "$JIRA_API_TOKEN" ]; then
    echo "✅ Jira credentials configured"
    echo "To test Jira server: cd mcp-servers/jira && node server.js"
else
    echo "⚠️  Jira credentials not configured"
fi

# Test Confluence MCP Server
echo "Testing Confluence MCP Server..."
if [ -n "$CONFLUENCE_BASE_URL" ] && [ -n "$CONFLUENCE_EMAIL" ] && [ -n "$CONFLUENCE_API_TOKEN" ]; then
    echo "✅ Confluence credentials configured"
    echo "To test Confluence server: cd mcp-servers/confluence && node server.js"
else
    echo "⚠️  Confluence credentials not configured"
fi

echo ""
echo "🎯 To start all servers simultaneously:"
echo "npm run dev"
echo ""
echo "📋 Available tools per server:"
echo ""
echo "Slack MCP Server tools:"
echo "• send_message - Send messages to Slack channels"
echo "• list_channels - List workspace channels"
echo "• get_channel_history - Get recent messages from channels"
echo "• search_messages - Search for messages"
echo ""
echo "Jira MCP Server tools:"
echo "• search_issues - Search issues with JQL"
echo "• get_issue - Get issue details"
echo "• create_issue - Create new issues"
echo "• update_issue - Update existing issues"
echo "• add_comment - Add comments to issues"
echo "• get_projects - List accessible projects"
echo "• get_issue_types - Get issue types for a project"
echo ""
echo "Confluence MCP Server tools:"
echo "• search_content - Search for pages and content"
echo "• get_page - Get page content"
echo "• get_spaces - List accessible spaces"
echo "• get_pages_in_space - Get pages in a space"
echo "• create_page - Create new pages"
echo "• update_page - Update existing pages"
