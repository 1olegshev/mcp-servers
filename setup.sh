#!/bin/bash

# MCP Servers Setup Script

echo "🚀 Setting up MCP Servers for Slack, Jira, and Confluence"

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js 16+ and try again."
    exit 1
fi

# Check if npm is installed
if ! command -v npm &> /dev/null; then
    echo "❌ npm is not installed. Please install npm and try again."
    exit 1
fi

echo "✅ Node.js and npm are installed"

# Install dependencies for root project
echo "📦 Installing root dependencies..."
npm install

# Install dependencies for each MCP server
echo "📦 Installing Slack MCP server dependencies..."
cd mcp-servers/slack && npm install && cd ../..

echo "📦 Installing Jira MCP server dependencies..."
cd mcp-servers/jira && npm install && cd ../..

echo "📦 Installing Confluence MCP server dependencies..."
cd mcp-servers/confluence && npm install && cd ..

echo "✅ Dependencies installed successfully"

# Create .env file if it doesn't exist
if [ ! -f .env ]; then
    echo "📝 Creating .env file from template..."
    cp env.example .env
    echo "⚠️  Please edit the .env file with your actual API keys and tokens"
else
    echo "ℹ️  .env file already exists"
fi

echo ""
echo "🎉 Setup complete! Next steps:"
echo "1. Edit the .env file with your actual API credentials"
echo "2. Configure your MCP client to use these servers"
echo "3. Test the servers individually:"
echo "   - npm run start:slack"
echo "   - npm run start:jira"
echo "   - npm run start:confluence"
echo ""
echo "📚 For more information, see README.md"
