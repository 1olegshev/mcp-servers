#!/usr/bin/env node

/**
 * Automated Release Status Script
 * This script directly calls the MCP release coordinator and posts to Slack
 */

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load MCP configuration
const mcpConfigPath = path.resolve(__dirname, '../.vscode/mcp.json');
const mcpConfig = JSON.parse(fs.readFileSync(mcpConfigPath, 'utf8'));

// Log file path for cron jobs
const logFilePath = path.resolve(__dirname, '../logs/cron-auto-release.log');

function log(message) {
  const timestamp = new Date().toISOString();
  const logLine = `${timestamp}: ${message}\n`;
  console.log(`${timestamp}: ${message}`);
  
  // Append to log file for cron jobs
  try {
    fs.appendFileSync(logFilePath, logLine);
  } catch (error) {
    console.error(`Failed to write to log file: ${error.message}`);
  }
}

async function callMCPServer(serverName, toolName, args = {}) {
  const serverConfig = mcpConfig.servers[serverName];
  if (!serverConfig) {
    throw new Error(`Server ${serverName} not found in mcp.json`);
  }

  // Use absolute path to node for cron compatibility
  const nodePath = '/Users/olegshevchenko/.nvm/versions/node/v22.9.0/bin/node';

  return new Promise((resolve, reject) => {
    const childProcess = spawn(nodePath, serverConfig.args, {
      cwd: serverConfig.cwd,
      env: { ...process.env, ...serverConfig.env },
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    childProcess.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    childProcess.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    childProcess.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`Process exited with code ${code}: ${stderr}`));
      } else {
        try {
          // Parse the JSON-RPC response
          const lines = stdout.trim().split('\n');
          const jsonLine = lines.find(line => line.startsWith('{'));
          if (jsonLine) {
            const response = JSON.parse(jsonLine);
            resolve(response);
          } else {
            resolve({ result: { content: [{ type: 'text', text: stdout }] } });
          }
        } catch (e) {
          resolve({ result: { content: [{ type: 'text', text: stdout }] } });
        }
      }
    });

    // Send JSON-RPC request
    const request = {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: toolName,
        arguments: args
      }
    };

    childProcess.stdin.write(JSON.stringify(request) + '\n');
    childProcess.stdin.end();
  });
}

async function runReleaseStatus() {
  try {
    log('Starting automated release status report...');
    
    // First, ensure MCP servers are built
    log('Building MCP servers...');
    await buildMCPServers();
    
    const today = new Date().toISOString().split('T')[0];
    
    log(`Calling release coordinator for ${today}...`);
    const result = await callMCPServer('release-coordinator', 'get_comprehensive_release_overview', {
      date: today,
      postToSlack: true
    });
    
    log('Release status report completed successfully!');
    
    if (result?.result?.content?.[0]?.text) {
      const content = result.result.content[0].text;
      log('Report preview: ' + content.substring(0, 200) + '...');
      
      if (content.includes('Posted to #qa-release-status')) {
        log('✅ Successfully posted to Slack!');
      } else {
        log('⚠️ Report generated but may not have posted to Slack');
      }
    }
    
    log('Automated release status completed successfully');
    process.exit(0);
    
  } catch (error) {
    log(`❌ Error: ${error.message}`);
    console.error('Full error:', error);
    log('Automated release status failed - see console for details');
    process.exit(1);
  }
}

async function buildMCPServers() {
  const { spawn } = await import('child_process');
  const nodePath = '/Users/olegshevchenko/.nvm/versions/node/v22.9.0/bin/node';
  const npmPath = '/Users/olegshevchenko/.nvm/versions/node/v22.9.0/bin/npm';
  
  return new Promise((resolve, reject) => {
    const buildProcess = spawn(npmPath, ['run', 'build'], {
      cwd: path.resolve(__dirname, '..'),
      env: { ...process.env, PATH: process.env.PATH },
      stdio: 'pipe'
    });

    let stdout = '';
    let stderr = '';

    buildProcess.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    buildProcess.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    buildProcess.on('close', (code) => {
      if (code !== 0) {
        log(`Build failed with code ${code}: ${stderr}`);
        reject(new Error(`Build failed: ${stderr}`));
      } else {
        log('MCP servers built successfully');
        resolve();
      }
    });
  });
}

runReleaseStatus();