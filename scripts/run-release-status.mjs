#!/usr/bin/env node
// Simple script to run Release Coordinator and post to Slack daily
// Uses JSON-RPC over stdio instead of importing SDK

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function getDirname() {
  const __filename = fileURLToPath(import.meta.url);
  return path.dirname(__filename);
}

async function main() {
  const today = new Date().toISOString().slice(0, 10);
  console.log(`[${new Date().toISOString()}] Running daily release status for ${today}`);

  const cwd = path.resolve(getDirname(), '../mcp-servers/release-coordinator');
  
  // JSON-RPC request
  const request = {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: {
      name: "get_comprehensive_release_overview",
      arguments: {
        date: today,
        postToSlack: true // Automatically post to #qa-release-status
      }
    }
  };

  try {
    const child = spawn('node', ['dist/server.js'], {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: process.env
    });

    let output = '';
    let errorOutput = '';

    child.stdout.on('data', (data) => {
      output += data.toString();
    });

    child.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });

    // Send the JSON-RPC request
    child.stdin.write(JSON.stringify(request) + '\n');
    child.stdin.end();

    await new Promise((resolve, reject) => {
      child.on('close', (code) => {
        if (code === 0) {
          try {
            // Parse the JSON-RPC response
            const lines = output.trim().split('\n');
            const lastLine = lines[lines.length - 1];
            const response = JSON.parse(lastLine);
            
            if (response.result?.content?.[0]?.text) {
              const reportText = response.result.content[0].text;
              console.log(`[${new Date().toISOString()}] ✅ Release status posted successfully`);
              console.log(reportText);
            } else if (response.error) {
              console.error(`[${new Date().toISOString()}] ❌ RPC Error:`, response.error);
              process.exitCode = 1;
            }
            resolve();
          } catch (parseError) {
            console.error(`[${new Date().toISOString()}] ❌ Parse Error:`, parseError.message);
            console.error('Raw output:', output);
            process.exitCode = 1;
            resolve();
          }
        } else {
          console.error(`[${new Date().toISOString()}] ❌ Process failed with code ${code}`);
          console.error('Error output:', errorOutput);
          process.exitCode = 1;
          reject(new Error(`Process exited with code ${code}`));
        }
      });
    });

  } catch (error) {
    console.error(`[${new Date().toISOString()}] ❌ Error:`, error?.message || error);
    process.exitCode = 1;
  }
}

main();