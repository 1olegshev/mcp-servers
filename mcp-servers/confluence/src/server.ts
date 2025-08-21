#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import dotenv from 'dotenv';
import { ConfluenceClient } from './confluence-client.js';
import { ConfluenceConfig } from './types.js';

// Load environment variables from parent directory
dotenv.config({ path: '../../.env' });

class ConfluenceMCPServer {
  private server: Server;
  private confluence: ConfluenceClient;
  private baseUrl: string;

  constructor() {
    this.server = new Server(
      {
        name: 'confluence-mcp-server',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.confluence = this.initializeConfluence();
    this.baseUrl = process.env.CONFLUENCE_BASE_URL || '';
    this.setupHandlers();
  }

  private getFullUrl(relativePath: string): string {
    if (!relativePath) return 'N/A';
    if (relativePath.startsWith('http')) return relativePath;
    
    // Remove leading slash if present to avoid double slashes
    const cleanPath = relativePath.startsWith('/') ? relativePath.slice(1) : relativePath;
    
    // Confluence Cloud URLs typically need /wiki prefix for the web UI
    return `${this.baseUrl}/wiki/${cleanPath}`;
  }

  private initializeConfluence(): ConfluenceClient {
    const config: ConfluenceConfig = {
      baseUrl: process.env.CONFLUENCE_BASE_URL || '',
      email: process.env.CONFLUENCE_EMAIL || '',
      apiToken: process.env.CONFLUENCE_API_TOKEN || '',
    };

    if (!config.baseUrl || !config.email || !config.apiToken) {
      console.error('❌ Missing Confluence configuration');
      console.error('Please set CONFLUENCE_BASE_URL, CONFLUENCE_EMAIL, and CONFLUENCE_API_TOKEN in .env');
      process.exit(1);
    }

    return new ConfluenceClient(config);
  }

  private setupHandlers(): void {
    // Handle tools/list
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: 'find_recent_qa_articles',
            description: 'Find the most recent articles, especially QA-related content',
            inputSchema: {
              type: 'object',
              properties: {
                limit: { 
                  type: 'number', 
                  description: 'Max articles to return', 
                  default: 10 
                }
              }
            }
          },
          {
            name: 'read_article',
            description: 'Read a specific Confluence article by ID',
            inputSchema: {
              type: 'object',
              properties: {
                pageId: { 
                  type: 'string', 
                  description: 'Page ID to read' 
                }
              },
              required: ['pageId']
            }
          },
          {
            name: 'search_pages',
            description: 'Search for Confluence pages by keywords',
            inputSchema: {
              type: 'object',
              properties: {
                query: { 
                  type: 'string', 
                  description: 'Search query' 
                },
                spaceKey: { 
                  type: 'string', 
                  description: 'Optional space to search in' 
                },
                limit: { 
                  type: 'number', 
                  description: 'Max results', 
                  default: 10 
                }
              },
              required: ['query']
            }
          },
          {
            name: 'get_spaces',
            description: 'List all available Confluence spaces',
            inputSchema: {
              type: 'object',
              properties: {
                limit: { 
                  type: 'number', 
                  description: 'Max spaces to return', 
                  default: 20 
                }
              }
            }
          },
          {
            name: 'search_by_author',
            description: 'Search for pages by author name',
            inputSchema: {
              type: 'object',
              properties: {
                authorName: { 
                  type: 'string', 
                  description: 'Author name to search for' 
                },
                limit: { 
                  type: 'number', 
                  description: 'Max results', 
                  default: 10 
                }
              },
              required: ['authorName']
            }
          }
        ]
      };
    });

    // Handle tools/call
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case 'find_recent_qa_articles':
            return await this.findRecentQAArticles((args as any)?.limit || 10);
          case 'read_article':
            return await this.readArticle((args as any)?.pageId);
          case 'search_pages':
            return await this.searchPages((args as any)?.query, (args as any)?.spaceKey, (args as any)?.limit || 10);
          case 'get_spaces':
            return await this.getSpaces((args as any)?.limit || 20);
          case 'search_by_author':
            return await this.searchByAuthor((args as any)?.authorName, (args as any)?.limit || 10);
          default:
            throw new Error(`Unknown tool: ${name}`);
        }
      } catch (error: any) {
        return {
          content: [{ 
            type: 'text', 
            text: `❌ Error: ${error.message}` 
          }]
        };
      }
    });
  }

  private async findRecentQAArticles(limit: number) {
    try {
      // Search for recent pages (since ORDER BY causes timeouts)
      const results = await this.confluence.searchContent('type=page', limit);
      
      if (results.results.length === 0) {
        return {
          content: [{ 
            type: 'text', 
            text: '❌ No articles found' 
          }]
        };
      }

      const pageList = results.results.slice(0, limit).map((page: any, index) => {
        const fullUrl = this.getFullUrl(page._links?.webui || '');
        return `${index + 1}. **${page.title}** (ID: ${page.id})\n   🔗 [Open in Confluence](${fullUrl})\n`;
      }).join('\n');

      return {
        content: [{
          type: 'text',
          text: `🎯 Found ${Math.min(results.results.length, limit)} recent articles:\n\n${pageList}\n💡 Use 'read_article' with a page ID to read the full content.`
        }]
      };
    } catch (error: any) {
      throw new Error(`Failed to find articles: ${error.message}`);
    }
  }

  private async readArticle(pageId: string) {
    if (!pageId) {
      throw new Error('Page ID is required');
    }

    try {
      const page = await this.confluence.getPage(pageId);

      let response = `📖 **${page.title}**\n\n`;
      response += `**📊 Metadata:**\n`;
      response += `• 🆔 Page ID: ${page.id}\n`;
      response += `• 🏠 Space: ${page.space?.name || 'Unknown'} (${page.space?.key || 'Unknown'})\n`;
      response += `• 📝 Version: ${page.version?.number || 'Unknown'}\n`;
      
      if (page.version?.when) {
        response += `• 🕒 Last Modified: ${new Date(page.version.when).toLocaleString()}\n`;
      }
      if (page.history?.createdBy?.displayName) {
        response += `• 👤 Author: ${page.history.createdBy.displayName}\n`;
      }
      
      response += `\n`;

      // Clean up content
      let content = page.body?.storage?.value || 'No content available';
      
      if (content !== 'No content available') {
        content = content
          .replace(/<h[1-6][^>]*>(.*?)<\/h[1-6]>/gi, '\n## $1\n')
          .replace(/<p[^>]*>(.*?)<\/p>/gi, '$1\n\n')
          .replace(/<strong[^>]*>(.*?)<\/strong>/gi, '**$1**')
          .replace(/<em[^>]*>(.*?)<\/em>/gi, '*$1*')
          .replace(/<li[^>]*>(.*?)<\/li>/gi, '• $1\n')
          .replace(/<br\s*\/?>/gi, '\n')
          .replace(/<[^>]*>/g, '')
          .replace(/\n\s*\n\s*\n/g, '\n\n')
          .trim();
      }

      response += `**📄 Content:**\n${content}`;

      return {
        content: [{ 
          type: 'text', 
          text: response 
        }]
      };
    } catch (error: any) {
      throw new Error(`Failed to read article: ${error.message}`);
    }
  }

  private async searchPages(query: string, spaceKey?: string, limit: number = 10) {
    if (!query) {
      throw new Error('Search query is required');
    }

    try {
      let cql = `type=page AND title ~ "${query}"`;
      if (spaceKey) {
        cql += ` AND space.key = "${spaceKey}"`;
      }

      const results = await this.confluence.searchContent(cql, limit);

      if (results.results.length === 0) {
        return {
          content: [{ 
            type: 'text', 
            text: `❌ No pages found matching "${query}"${spaceKey ? ` in space ${spaceKey}` : ''}` 
          }]
        };
      }

      const pageList = results.results.map((page: any, index) => {
        const fullUrl = this.getFullUrl(page._links?.webui || '');
        return `${index + 1}. **${page.title}** (ID: ${page.id})\n   🔗 [Open in Confluence](${fullUrl})\n`;
      }).join('\n');

      return {
        content: [{
          type: 'text',
          text: `🔍 Found ${results.results.length} pages matching "${query}":\n\n${pageList}`
        }]
      };
    } catch (error: any) {
      throw new Error(`Failed to search pages: ${error.message}`);
    }
  }

  private async getSpaces(limit: number = 20) {
    try {
      const spaces = await this.confluence.getSpaces('global', limit);

      const spaceList = spaces.results.map(space => {
        return `• **${space.key}**: ${space.name}`;
      }).join('\n');

      return {
        content: [{
          type: 'text',
          text: `📚 Found ${spaces.results.length} spaces:\n\n${spaceList}\n\n💡 Use space keys with 'search_pages' to search within specific spaces.`
        }]
      };
    } catch (error: any) {
      throw new Error(`Failed to get spaces: ${error.message}`);
    }
  }

  private async searchByAuthor(authorName: string, limit: number = 10) {
    if (!authorName) {
      throw new Error('Author name is required');
    }

    try {
      // Use CQL to search by creator with proper syntax
      let cql = `type=page AND creator.fullname ~ "${authorName}"`;
      
      const results = await this.confluence.searchContent(cql, limit);

      if (results.results.length === 0) {
        // Try with just first name or last name
        const nameParts = authorName.split(' ');
        if (nameParts.length > 1) {
          const firstName = nameParts[0];
          const lastName = nameParts[nameParts.length - 1];
          cql = `type=page AND (creator.fullname ~ "${firstName}" OR creator.fullname ~ "${lastName}")`;
          
          const fallbackResults = await this.confluence.searchContent(cql, limit);
          
          if (fallbackResults.results.length === 0) {
            // Try even broader search in content
            cql = `type=page AND text ~ "${authorName}"`;
            const contentResults = await this.confluence.searchContent(cql, limit);
            
            if (contentResults.results.length === 0) {
              return {
                content: [{ 
                  type: 'text', 
                  text: `❌ No pages found authored by "${authorName}". Try searching with different name variations.` 
                }]
              };
            }
            
            const pageList = contentResults.results.map((page: any, index) => {
              const content = page.content || page;
              const lastModified = content.history?.lastUpdated?.when || content.version?.when;
              const author = content.history?.lastUpdated?.by?.displayName || content.version?.by?.displayName;
              const fullUrl = this.getFullUrl(content._links?.webui || '');
              
              let metadata = '';
              if (author) {
                metadata += `\n   👤 Last modified by: ${author}`;
              }
              if (lastModified && lastModified !== 'Unknown') {
                try {
                  metadata += `\n   🕒 Date: ${new Date(lastModified).toLocaleDateString()}`;
                } catch (e) {
                  // Skip invalid dates
                }
              }
              
              return `${index + 1}. **${content.title}** (ID: ${content.id})${metadata}\n   🔗 [Open in Confluence](${fullUrl})\n`;
            }).join('\n');

            return {
              content: [{
                type: 'text',
                text: `🔍 Found ${contentResults.results.length} pages mentioning "${authorName}" in content:\n\n${pageList}`
              }]
            };
          }
          
          const pageList = fallbackResults.results.map((page: any, index) => {
            const content = page.content || page;
            const lastModified = content.history?.lastUpdated?.when || content.version?.when;
            const author = content.history?.lastUpdated?.by?.displayName || content.version?.by?.displayName;
            const fullUrl = this.getFullUrl(content._links?.webui || '');
            
            let metadata = '';
            if (author) {
              metadata += `\n   👤 Last modified by: ${author}`;
            }
            if (lastModified && lastModified !== 'Unknown') {
              try {
                metadata += `\n   🕒 Date: ${new Date(lastModified).toLocaleDateString()}`;
              } catch (e) {
                // Skip invalid dates
              }
            }
            
            return `${index + 1}. **${content.title}** (ID: ${content.id})${metadata}\n   🔗 [Open in Confluence](${fullUrl})\n`;
          }).join('\n');

          return {
            content: [{
              type: 'text',
              text: `🔍 Found ${fallbackResults.results.length} pages with name variations of "${authorName}":\n\n${pageList}`
            }]
          };
        }
        
        return {
          content: [{ 
            type: 'text', 
            text: `❌ No pages found authored by "${authorName}"` 
          }]
        };
      }

      const pageList = results.results.map((page: any, index) => {
        // Search results have content nested structure
        const content = page.content || page;
        const lastModified = content.history?.lastUpdated?.when || content.version?.when;
        const author = content.history?.lastUpdated?.by?.displayName || content.version?.by?.displayName;
        const fullUrl = this.getFullUrl(content._links?.webui || '');
        
        // Only show date/author if we have valid data
        let metadata = '';
        if (author) {
          metadata += `\n   👤 Last modified by: ${author}`;
        }
        if (lastModified && lastModified !== 'Unknown') {
          try {
            metadata += `\n   🕒 Date: ${new Date(lastModified).toLocaleDateString()}`;
          } catch (e) {
            // Skip invalid dates
          }
        }
        
        return `${index + 1}. **${content.title}** (ID: ${content.id})${metadata}\n   🔗 [Open in Confluence](${fullUrl})\n`;
      }).join('\n');

      return {
        content: [{
          type: 'text',
          text: `👤 Found ${results.results.length} pages by "${authorName}":\n\n${pageList}`
        }]
      };
    } catch (error: any) {
      throw new Error(`Failed to search by author: ${error.message}`);
    }
  }

  async run(): Promise<void> {
    try {
      // Test connection first
      await this.confluence.testConnection();
      console.error('✅ Confluence connection successful');

      const transport = new StdioServerTransport();
      await this.server.connect(transport);
      console.error('🚀 Confluence MCP server running on stdio');
    } catch (error: any) {
      console.error('❌ Failed to start server:', error.message);
      process.exit(1);
    }
  }
}

// Start the server
const server = new ConfluenceMCPServer();
server.run();