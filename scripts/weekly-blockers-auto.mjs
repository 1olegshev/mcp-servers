#!/usr/bin/env node

/**
 * Automated Weekly Blockers Report Script
 * Runs on Fridays at 14:00 CET to compile the week's blockers and post to Slack
 */

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Load environment variables from .env file
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.resolve(__dirname, '../.env');

if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  const envLines = envContent.split('\n');

  for (const line of envLines) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const [key, ...valueParts] = trimmed.split('=');
      if (key && valueParts.length > 0) {
        const value = valueParts.join('=').replace(/^["']|["']$/g, ''); // Remove quotes
        process.env[key.trim()] = value.trim();
      }
    }
  }
}

// Load MCP configuration
const mcpConfigPath = path.resolve(__dirname, '../.vscode/mcp.json');
const mcpConfig = JSON.parse(fs.readFileSync(mcpConfigPath, 'utf8'));

// Log file path for cron jobs
const logFilePath = path.resolve(__dirname, '../logs/cron-weekly-blockers.log');

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

  // Resolve environment variables in serverConfig.env
  const resolvedEnv = {};
  for (const [key, value] of Object.entries(serverConfig.env || {})) {
    if (typeof value === 'string' && value.startsWith('${') && value.endsWith('}')) {
      const envVar = value.slice(2, -1); // Remove ${ and }
      resolvedEnv[key] = process.env[envVar] || '';
    } else {
      resolvedEnv[key] = value;
    }
  }

  // Use absolute path to node for cron compatibility
  const nodePath = '/Users/olegshevchenko/.nvm/versions/node/v22.9.0/bin/node';

  return new Promise((resolve, reject) => {
    const childProcess = spawn(nodePath, serverConfig.args, {
      cwd: serverConfig.cwd,
      env: { ...process.env, ...resolvedEnv },
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

async function runWeeklyBlockersReport() {
  try {
    log('Starting automated weekly blockers report...');

    // First, ensure MCP servers are built
    log('Building MCP servers...');
    await buildMCPServers();

    log('Calling release coordinator for weekly blockers...');
    const result = await callMCPServer('release-coordinator', 'get_weekly_blockers_report', {
      weekOffset: 0,  // Current week
      postToSlack: true
    });

    log('Weekly blockers report completed successfully!');

    if (result?.result?.content?.[0]?.text) {
      const content = result.result.content[0].text;
      log('Report preview: ' + content.substring(0, 200) + '...');

      if (content.includes('Posted to #qa-release-status')) {
        log('Successfully posted to Slack!');
      } else {
        log('Report generated but may not have posted to Slack');
      }
    }

    log('Automated weekly blockers report completed successfully');
    process.exit(0);

  } catch (error) {
    log(`Error: ${error.message}`);
    console.error('Full error:', error);
    log('Automated weekly blockers report failed - see console for details');
    process.exit(1);
  }
}

async function buildMCPServers() {
  const { spawn } = await import('child_process');
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

runWeeklyBlockersReport();
