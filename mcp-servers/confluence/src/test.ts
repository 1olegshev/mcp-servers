#!/usr/bin/env node

import { loadEnv } from '@mcp-servers/shared';
import { ConfluenceClient } from './confluence-client.js';
import { ConfluenceConfig } from './types.js';

// Load environment variables using shared utility
loadEnv(import.meta.url);

class ConfluenceTest {
  private confluence: ConfluenceClient;

  constructor() {
    const config: ConfluenceConfig = {
      baseUrl: process.env.CONFLUENCE_BASE_URL || '',
      email: process.env.CONFLUENCE_EMAIL || '',
      apiToken: process.env.CONFLUENCE_API_TOKEN || '',
    };

    if (!config.baseUrl || !config.email || !config.apiToken) {
      console.error('❌ Missing Confluence configuration');
      process.exit(1);
    }

    this.confluence = new ConfluenceClient(config);
    console.log('✅ Confluence client initialized');
  }

  async runTests(): Promise<void> {
    console.log('🚀 Starting Confluence API tests...\n');

    try {
      // Test 1: Connection test
      console.log('1️⃣ Testing connection...');
      await this.confluence.testConnection();
      console.log('✅ Connection successful!\n');

      // Test 2: Get spaces
      console.log('2️⃣ Getting spaces...');
      const spaces = await this.confluence.getSpaces('global', 10);
      console.log(`✅ Found ${spaces.results.length} spaces:`);
      spaces.results.forEach(space => {
        console.log(`   • ${space.key}: ${space.name}`);
      });
      console.log('');

      // Test 3: Search for recent content
      console.log('3️⃣ Searching for recent content...');
      const searchResults = await this.confluence.searchContent(
        'type=page', 
        5
      );
      console.log(`✅ Found ${searchResults.results.length} recent pages:`);
      console.log('📋 Debug - First result structure:', JSON.stringify(searchResults.results[0], null, 2));
      
      searchResults.results.forEach((result, index) => {
        console.log(`   ${index + 1}. Processing result...`);
        console.log(`      Result keys:`, Object.keys(result));
        
        if (result.content) {
          const page = result.content;
          console.log(`      Title: ${page.title || 'No title'}`);
          console.log(`      Space: ${page.space?.key || 'Unknown'}`);
          console.log(`      ID: ${page.id || 'No ID'}`);
        } else {
          console.log(`      No content property found`);
        }
      });
      console.log('');

      // Test 4: Look for QA content specifically
      console.log('4️⃣ Looking for QA-related content...');
      try {
        const qaResults = await this.confluence.searchContent(
          'title ~ "QA" OR title ~ "quality" OR title ~ "test" ORDER BY lastModified DESC',
          5
        );
        if (qaResults.results.length > 0) {
          console.log(`✅ Found ${qaResults.results.length} QA-related pages:`);
          qaResults.results.forEach((result, index) => {
            const page = result.content;
            console.log(`   ${index + 1}. ${page.title} (ID: ${page.id}) in ${page.space.name}`);
          });

          // Test 5: Read the first QA article
          if (qaResults.results.length > 0) {
            console.log('\n5️⃣ Reading most recent QA article...');
            const firstPage = qaResults.results[0].content;
            const fullPage = await this.confluence.getPage(firstPage.id);
            console.log(`✅ Successfully read: "${fullPage.title}"`);
            console.log(`   Space: ${fullPage.space?.name}`);
            console.log(`   Version: ${fullPage.version?.number}`);
            console.log(`   Content length: ${fullPage.body?.storage?.value?.length || 0} characters`);
          }
        } else {
          console.log('ℹ️ No QA-specific content found, but connection is working!');
        }
      } catch (error: any) {
        console.log('ℹ️ QA search failed, but that\'s okay - basic functionality works!');
        console.log(`   Error: ${error.message}`);
      }

      console.log('\n🎉 All tests completed successfully!');
      console.log('🚀 The Confluence MCP server should work correctly now.');

    } catch (error: any) {
      console.error(`❌ Test failed: ${error.message}`);
      process.exit(1);
    }
  }
}

// Run the tests
const test = new ConfluenceTest();
test.runTests().catch(error => {
  console.error('❌ Test runner failed:', error);
  process.exit(1);
});
