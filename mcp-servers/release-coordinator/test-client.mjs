#!/usr/bin/env node

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

console.log('Testing Release Coordinator MCP Server...\n');

// Start the server process
const serverProcess = spawn('node', ['dist/server.js'], {
  cwd: __dirname,
  stdio: ['pipe', 'pipe', 'pipe']
});

// Test: List available tools
const listToolsRequest = {
  jsonrpc: "2.0",
  id: 1,
  method: "tools/list"
};

console.log('📋 Sending list tools request...');
serverProcess.stdin.write(JSON.stringify(listToolsRequest) + '\n');

// Test: Call the comprehensive release overview tool
setTimeout(() => {
  const callToolRequest = {
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: {
      name: "get_comprehensive_release_overview",
      arguments: {}
    }
  };

  console.log('\n🚀 Calling get_comprehensive_release_overview...');
  serverProcess.stdin.write(JSON.stringify(callToolRequest) + '\n');
}, 1000);

// Handle server responses
serverProcess.stdout.on('data', (data) => {
  const lines = data.toString().split('\n').filter(line => line.trim());
  lines.forEach(line => {
    try {
      const response = JSON.parse(line);
      console.log('\n📥 Server response:');
      console.log(JSON.stringify(response, null, 2));
    } catch (e) {
      console.log('📄 Raw output:', line);
    }
  });
});

serverProcess.stderr.on('data', (data) => {
  console.log('🔧 Server stderr:', data.toString());
});

// Clean shutdown after 5 seconds
setTimeout(() => {
  console.log('\n✅ Test completed, shutting down...');
  serverProcess.kill();
  process.exit(0);
}, 5000);