// Debug test for issue detection
import fs from 'fs';

const blockerText = `<https://pandora.kahoost.com/job/frontend/job/kahoot-front-release-pipeline/|FE release pipeline aborted>, it's Friday cc <!subteam^S07RZGWLU69> <@U02HDA1GFFE>

One blocker for Monday:
• ~<https://mobitroll.atlassian.net/browse/KAHOOT-64753> - Log in/Sign up via Google is not working.~ 
    ◦ Changes will be reverted via <https://mobitroll.atlassian.net/browse/KAHOOT-64277>
• <https://mobitroll.atlassian.net/browse/KAHOOT-64769>`;

function analyzeIssueSeverity(text) {
    const lowerText = text.toLowerCase();
    
    const blockingKeywords = ['blocker', 'blocking', 'release blocker', 'blocks release', 'block release'];
    const criticalKeywords = ['critical', 'urgent', 'high priority', 'must fix', 'critical issue'];
    
    const isBlocking = blockingKeywords.some(keyword => lowerText.includes(keyword));
    const isCritical = criticalKeywords.some(keyword => lowerText.includes(keyword));
    
    return { isBlocking, isCritical };
}

function hasBlockingIndicators(text) {
    const lowerText = text.toLowerCase();
    
    return lowerText.includes('@test-managers') ||
           lowerText.includes('hotfix') ||
           /block(ing|er|s)/i.test(text) ||
           /no.?go/i.test(text);
}

console.log('=== TESTING BLOCKER MESSAGE ===');
console.log('Text:', blockerText);
console.log('\n=== Basic Analysis ===');
const basic = analyzeIssueSeverity(blockerText);
console.log('Basic analysis:', basic);

console.log('\n=== Enhanced Analysis ===');
const enhanced = hasBlockingIndicators(blockerText);
console.log('Has blocking indicators:', enhanced);

console.log('\n=== Pattern Tests ===');
console.log('Contains "blocker":', blockerText.toLowerCase().includes('blocker'));
console.log('Regex test:', /block(ing|er|s)/i.test(blockerText));

// Check if thread/resolution logic might be interfering
console.log('\n=== Potential Issues ===');
console.log('Has strikethrough (~):', blockerText.includes('~'));
console.log('Has resolution indicators:', /resolved|fixed|done/i.test(blockerText));

// Log to file
const debugLog = `
=== DEBUG LOG ${new Date().toISOString()} ===
Text: ${blockerText}
Basic analysis: ${JSON.stringify(basic)}
Enhanced blocking: ${enhanced}
Contains "blocker": ${blockerText.toLowerCase().includes('blocker')}
Regex test: ${/block(ing|er|s)/i.test(blockerText)}
Has strikethrough: ${blockerText.includes('~')}
`;

fs.writeFileSync('/Users/olegshevchenko/Sourses/MCP/mcp-servers/slack/debug.log', debugLog);
console.log('\nDebug info written to debug.log');