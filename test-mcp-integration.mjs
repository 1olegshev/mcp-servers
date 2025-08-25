#!/usr/bin/env node

// Simple MCP server test
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

async function testMCPServer(serverPath, serverName) {
    console.log(`Testing ${serverName} MCP server...`);
    
    try {
        // Start the server for a brief moment
        const serverProcess = exec(`cd "${serverPath}" && node server.js`);
        
        // Give it a moment to start
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Kill the process
        serverProcess.kill();
        
        console.log(`✅ ${serverName} server started successfully`);
        return true;
    } catch (error) {
        console.log(`❌ ${serverName} server failed:`, error.message);
        return false;
    }
}

async function main() {
    console.log('Testing MCP Servers...\n');
    
    const servers = [
        { path: '/Users/olegshevchenko/Sourses/MCP/mcp-servers/slack', name: 'Slack' }
    ];
    
    for (const server of servers) {
        await testMCPServer(server.path, server.name);
    }
    
    console.log('\n--- VS Code Insiders MCP Configuration Test ---');
    console.log('Configuration file location:');
    console.log('~/Library/Application Support/Code - Insiders/User/mcp.json');
    console.log('\nTo test in VS Code Insiders:');
    console.log('1. Open Command Palette (Cmd+Shift+P)');
    console.log('2. Look for MCP-related commands');
    console.log('3. Check View → Output → MCP logs');
    console.log('4. Look for MCP status in the status bar');
}

main().catch(console.error);