const { WebClient } = require('@slack/web-api');

const token = process.env.SLACK_MCP_XOXC_TOKEN;
const client = new WebClient(token);

async function getBotMessage() {
  try {
    // Get a specific message by timestamp (from the link references in human summaries)
    const result = await client.conversations.history({
      channel: 'C04PX79QK', // functional-testing
      latest: '1755511674.229969', // One of the referenced timestamps
      inclusive: true,
      limit: 1
    });
    
    if (result.messages && result.messages.length > 0) {
      const message = result.messages[0];
      console.log('=== BOT MESSAGE STRUCTURE ===');
      console.log(JSON.stringify(message, null, 2));
    } else {
      console.log('No message found at that timestamp');
    }
    
  } catch (error) {
    console.error('Error:', error.message);
  }
}

getBotMessage();
