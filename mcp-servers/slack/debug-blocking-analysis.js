import { SlackClient } from './dist/clients/slack-client.js';

async function testBlockingAnalysis() {
  const client = new SlackClient();

  // Get the thread messages
  const parentMsg = await client.getMessageDetails('functional-testing', '1757046622.956619');
  const replies = await client.getThreadReplies('functional-testing', '1757046622.956619');
  const allMessages = [parentMsg, ...replies];

  console.log('Thread messages:');
  allMessages.forEach((msg, i) => {
    console.log(`${i + 1}. ${msg.text?.substring(0, 100)}`);
  });

  const tickets = ['KAHOOT-65023', 'KAHOOT-65024', 'KAHOOT-65025'];

  for (const ticketKey of tickets) {
    console.log(`\nAnalyzing ${ticketKey}:`);

    let isBlocking = false;

    for (const message of allMessages) {
      const text = (message.text || '').toLowerCase();
      const mentionsTicket = text.includes(ticketKey.toLowerCase());
      const mentionsBlockers = /\bblockers?\b/i.test(text) || /\bblocking\b/i.test(text);

      console.log(`  Message: ${text.substring(0, 60)}...`);

      if (mentionsBlockers && !mentionsTicket) {
        const ticketNumbers = text.match(/\b\d{5}\b/g) || [];
        if (ticketNumbers.some(num => ticketKey.includes(num))) {
          console.log(`  -> Found in blocker list!`);
          isBlocking = true;
        }
      }

      if (mentionsTicket) {
        const hasResolutionKeyword = /not.*blocking/i.test(text) || /\bnot a blocker\b/i.test(text);
        console.log(`  Has resolution: ${hasResolutionKeyword}`);

        if (hasResolutionKeyword) {
          isBlocking = false;
        }
      }
    }

    console.log(`  RESULT: ${ticketKey} is ${isBlocking ? 'BLOCKING' : 'NOT BLOCKING'}`);
  }
}

testBlockingAnalysis().catch(console.error);
