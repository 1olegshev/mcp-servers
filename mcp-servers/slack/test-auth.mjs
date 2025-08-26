#!/usr/bin/env node

import { SlackXOXCClient } from './dist/slack-http-client.js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.resolve(__dirname, '../../.env');
dotenv.config({ path: envPath });

async function testAuth() {
  const xoxc = process.env.SLACK_MCP_XOXC_TOKEN;
  const xoxd = process.env.SLACK_MCP_XOXD_TOKEN;
  const teamId = process.env.SLACK_TEAM_ID;

  console.log('Testing XOXC authentication...');
  console.log(`XOXC: ${xoxc ? xoxc.substring(0, 15) + '...' : 'missing'}`);
  console.log(`XOXD: ${xoxd ? 'present' : 'missing'}`);
  console.log(`Team: ${teamId || 'missing'}`);

  if (!xoxc) {
    console.error('SLACK_MCP_XOXC_TOKEN not found in environment');
    process.exit(1);
  }

  const client = new SlackXOXCClient(xoxc, xoxd, teamId);

  try {
    console.log('\n1. Testing auth.test...');
    const authResult = await client.authTest();
    console.log('✅ Auth test successful!');
    console.log(`   User: ${authResult.user}`);
    console.log(`   Team: ${authResult.team}`);
    console.log(`   URL: ${authResult.url}`);

    console.log('\n2. Testing conversations.history...');
    const historyResult = await client.conversationsHistory({
      channel: 'C04PX79QK', // The allowed reading channel
      limit: 1
    });
    console.log('✅ Channel history successful!');
    console.log(`   Messages: ${historyResult.messages?.length || 0}`);

    console.log('\n3. Testing chat.postMessage...');
    try {
      const messageResult = await client.chatPostMessage({
        channel: 'C09BW9Y2HSN', // The allowed posting channel
        text: '🧪 Test message from cleaned up XOXC client'
      });
      console.log('✅ Message sending successful!');
      console.log(`   Timestamp: ${messageResult.ts}`);
    } catch (error) {
      console.log('❌ Message sending failed:');
      console.log(`   Error: ${error.message}`);
    }

  } catch (error) {
    console.error('❌ Authentication failed:');
    console.error(`   Error: ${error.message}`);
    process.exit(1);
  }
}

testAuth().catch(console.error);