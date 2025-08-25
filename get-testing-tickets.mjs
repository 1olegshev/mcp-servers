#!/usr/bin/env node

import { spawn } from 'child_process';
import { resolve } from 'path';

async function callMCPTool(serverPath, toolName, args = {}) {
    return new Promise((resolvePromise, reject) => {
        const server = spawn('node', ['dist/server.js'], {
            cwd: serverPath,
            stdio: ['pipe', 'pipe', 'pipe']
        });

        let output = '';
        let errorOutput = '';

        server.stdout.on('data', (data) => {
            output += data.toString();
        });

        server.stderr.on('data', (data) => {
            errorOutput += data.toString();
        });

        server.on('close', (code) => {
            if (code === 0) {
                resolvePromise(output);
            } else {
                reject(new Error(`Server exited with code ${code}: ${errorOutput}`));
            }
        });

        // Send MCP protocol messages
        const request = {
            jsonrpc: '2.0',
            id: 1,
            method: 'tools/call',
            params: {
                name: toolName,
                arguments: args
            }
        };

        server.stdin.write(JSON.stringify(request) + '\n');
        
        // Give it time to process
        setTimeout(() => {
            server.kill();
            resolvePromise(output);
        }, 5000);
    });
}

async function main() {
    try {
        const jiraServerPath = resolve('./mcp-servers/jira');
        
        console.log('🔍 Searching for tickets in testing...\n');
        
        // Search for tickets in QA status
        const result = await callMCPTool(jiraServerPath, 'search_issues', {
            jql: 'status = "IN QA"',
            limit: 50
        });
        
        console.log('Result:', result);
        
    } catch (error) {
        console.error('❌ Error:', error.message);
    }
}

main();
