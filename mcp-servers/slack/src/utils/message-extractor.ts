/**
 * Slack Message Text Extraction Utilities
 * Based on slack_mcp_github approach to handle Block Kit and attachments
 */

import { SlackMessage } from '../types/index.js';

export interface ExtractedText {
  text: string;
  hasBlocks: boolean;
  hasAttachments: boolean;
  extractedFromBlocks?: string;
  extractedFromAttachments?: string;
}

/**
 * Extract meaningful text from Slack Block Kit blocks
 */
export function extractTextFromBlocks(blocks: any[]): string {
  if (!blocks || blocks.length === 0) return '';
  
  const textParts: string[] = [];
  
  for (const block of blocks) {
    if (block.type === 'section') {
      // Handle section blocks with text
      if (block.text?.text) {
        textParts.push(block.text.text);
      }
      
      // Handle section blocks with fields
      if (block.fields) {
        for (const field of block.fields) {
          if (field.text) {
            textParts.push(field.text);
          }
        }
      }
      
      // Handle accessory elements
      if (block.accessory?.text) {
        textParts.push(block.accessory.text);
      }
    }
    
    if (block.type === 'rich_text') {
      // Handle rich text blocks
      if (block.elements) {
        for (const element of block.elements) {
          if (element.type === 'rich_text_section' && element.elements) {
            for (const subElement of element.elements) {
              if (subElement.text) {
                textParts.push(subElement.text);
              }
            }
          }
        }
      }
    }
    
    if (block.type === 'context') {
      // Handle context blocks
      if (block.elements) {
        for (const element of block.elements) {
          if (element.text) {
            textParts.push(element.text);
          }
        }
      }
    }
    
    if (block.type === 'header') {
      // Handle header blocks
      if (block.text?.text) {
        textParts.push(`Header: ${block.text.text}`);
      }
    }
    
    if (block.type === 'divider') {
      textParts.push('---');
    }
  }
  
  return textParts.join(' ').trim();
}

/**
 * Extract meaningful text from Slack attachments
 * Based on the Go implementation in text_processor.go
 */
export function extractTextFromAttachments(attachments: any[]): string {
  if (!attachments || attachments.length === 0) return '';
  
  const descriptions: string[] = [];
  
  for (const att of attachments) {
    const parts: string[] = [];
    
    if (att.title) {
      parts.push(`Title: ${att.title}`);
    }
    
    if (att.author_name) {
      parts.push(`Author: ${att.author_name}`);
    }
    
    if (att.pretext) {
      parts.push(`Pretext: ${att.pretext}`);
    }
    
    if (att.text) {
      parts.push(`Text: ${att.text}`);
    }
    
    if (att.footer) {
      parts.push(`Footer: ${att.footer}`);
    }
    
    // Handle fields
    if (att.fields) {
      for (const field of att.fields) {
        if (field.title && field.value) {
          parts.push(`${field.title}: ${field.value}`);
        }
      }
    }
    
    if (parts.length > 0) {
      let result = parts.join('; ');
      // Clean up the text like the Go version
      result = result.replace(/\n/g, ' ');
      result = result.replace(/\r/g, ' ');
      result = result.replace(/\t/g, ' ');
      result = result.replace(/\(/g, '[');
      result = result.replace(/\)/g, ']');
      result = result.trim();
      
      descriptions.push(result);
    }
  }
  
  return descriptions.join(', ');
}

/**
 * Extract all available text from a Slack message
 * Combines text, blocks, and attachments like the Go implementation
 */
export function extractAllMessageText(message: SlackMessage): ExtractedText {
  const result: ExtractedText = {
    text: '',
    hasBlocks: !!(message as any).blocks && (message as any).blocks.length > 0,
    hasAttachments: !!(message as any).attachments && (message as any).attachments.length > 0
  };
  
  let textParts: string[] = [];
  
  // Start with the base text
  if (message.text) {
    textParts.push(message.text);
  }
  
  // Extract from Block Kit blocks
  if (result.hasBlocks) {
    const blocksText = extractTextFromBlocks((message as any).blocks);
    if (blocksText) {
      result.extractedFromBlocks = blocksText;
      textParts.push(blocksText);
    }
  }
  
  // Extract from attachments
  if (result.hasAttachments) {
    const attachmentsText = extractTextFromAttachments((message as any).attachments);
    if (attachmentsText) {
      result.extractedFromAttachments = attachmentsText;
      textParts.push(attachmentsText);
    }
  }
  
  result.text = textParts.join(' ').trim();
  return result;
}

/**
 * Check if a message appears to be from a bot based on various indicators
 */
export function isBotMessage(message: SlackMessage): boolean {
  // Check subtype
  if ((message as any).subtype === 'bot_message') {
    return true;
  }
  
  // Check for bot_id
  if ((message as any).bot_id) {
    return true;
  }
  
  // Check if user looks like a bot user ID (known bot patterns)
  if (message.user && (
    message.user.startsWith('U067') || // Cypress bot pattern
    message.user === 'U06K7JLHL03' ||  // Known Jenkins bot
    message.user === 'U020H4HR8HM'     // Another known bot
  )) {
    return true;
  }
  
  // Check username for bot patterns
  if ((message as any).username) {
    const username = (message as any).username.toLowerCase();
    if (username.includes('jenkins') || 
        username.includes('cypress') || 
        username.includes('bot') ||
        username.includes('automation')) {
      return true;
    }
  }
  
  return false;
}

/**
 * Parse test results from extracted message text
 */
export function parseTestResultsFromText(text: string): {
  testType?: string;
  status?: string;
  failedTests: string[];
  runNumber?: string;
  details?: string;
} {
  const result: {
    testType?: string;
    status?: string;
    failedTests: string[];
    runNumber?: string;
    details?: string;
  } = {
    failedTests: [],
  };
  
  // Normalize URL-encoded sequences to avoid artifacts like '2flibrary_...'
  let processed = text;
  try {
    // decodeURIComponent can throw if stray %; guard it
    processed = decodeURIComponent(text);
  } catch {}
  processed = processed.replace(/%2F/gi, '/');
  const textLower = processed.toLowerCase();

  // Look for run numbers
  const runMatch = processed.match(/Run #(\d+)/i);
  if (runMatch) {
    result.runNumber = runMatch[1];
  }
  
  // Look for test types
  if (textLower.includes('cypress')) {
    result.testType = 'cypress';
  } else if (textLower.includes('jenkins')) {
    result.testType = 'jenkins';
  } else if (textLower.includes('playwright')) {
    result.testType = 'playwright';
  }
  
  // Look for status indicators - prioritize failure detection
  if (textLower.includes('failed run') || textLower.includes('failed build') || 
      (textLower.includes('failed') && textLower.includes('test')) || 
      processed.includes('❌')) {
    result.status = 'failed';
  } else if (textLower.includes('passed run') || textLower.includes('passed build') || 
             textLower.includes('success') ||
             (textLower.includes('passed') && !textLower.includes('failed')) || 
             processed.includes('✅') || processed.includes('🟢')) {
    result.status = 'passed';
  }
  
  // Extract failed test names (pattern: filename_spec.ts or similar)
  const testFilePattern = /([\w\-\/]+(?:_spec|\.spec|\.test|_test)\.[jt]sx?)/gi;
  const testMatches = processed.match(testFilePattern);
  if (testMatches) {
    // Normalize to basename and dedup, also strip leading slashes or artifacts
    const normalized = testMatches.map(m => {
      const cleaned = m.replace(/^\/*/, '');
      const base = cleaned.replace(/^.*[\\/]/, '');
      return base.replace(/^2f+/i, '');
    });
    result.failedTests = Array.from(new Set(normalized));
  }
  
  return result;
}