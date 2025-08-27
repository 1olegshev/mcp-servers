const { readFileSync } = require('fs');
const { resolve } = require('path');

// Load environment variables
require('dotenv').config({ path: resolve(__dirname, '../../../.env') });

const { WebClient } = require('@slack/web-api');

async function getRawMessages() {
  try {
    // Initialize Slack client with the session token  
    const slack = new WebClient(process.env.SLACK_BOT_TOKEN);

    console.log('Getting channel list...');
    
    // Get channel ID for functional-testing
    const channels = await slack.conversations.list({
      types: 'public_channel,private_channel',
      limit: 1000
    });
    
    const targetChannel = channels.channels.find(ch => ch.name === 'functional-testing');
    if (!targetChannel) {
      console.log('Channel functional-testing not found');
      return;
    }
    
    console.log(`Found channel: ${targetChannel.name} (${targetChannel.id})`);
    
    // Get recent messages
    console.log('Getting messages...');
    const result = await slack.conversations.history({
      channel: targetChannel.id,
      limit: 30
    });
    
    console.log(`Found ${result.messages.length} messages`);
    
    // Look for bot messages and show their timestamps and structure
    result.messages.forEach((msg, index) => {
      if (msg.user && (msg.user.startsWith('U067') || msg.text === 'undefined' || (msg.text && msg.text.includes('Run #')))) {
        console.log(`\n=== Message ${index} ===`);
        console.log(`Timestamp: ${msg.ts}`);
        console.log(`User: ${msg.user}`);
        console.log(`Text: ${msg.text || 'no text'}`);
        console.log(`Has blocks: ${!!msg.blocks}`);
        console.log(`Has attachments: ${!!msg.attachments}`);
        if (msg.blocks) {
          console.log(`Blocks: ${JSON.stringify(msg.blocks, null, 2)}`);
        }
        if (msg.attachments) {
          console.log(`Attachments: ${JSON.stringify(msg.attachments, null, 2)}`);
        }
      }
    });
    
  } catch (error) {
    console.error('Error:', error.message);
    if (error.data) {
      console.error('Error data:', error.data);
    }
  }
}

getRawMessages();