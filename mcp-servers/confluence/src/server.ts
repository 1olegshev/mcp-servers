#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { ConfluenceClient } from './confluence-client.js';
import { ConfluenceConfig } from './types.js';

// Load environment variables using __dirname for robust path resolution
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.resolve(__dirname, '../../../.env');
dotenv.config({ path: envPath });

class ConfluenceMCPServer {
  private server: Server;
  private confluence: ConfluenceClient;
  private baseUrl: string;
  private readonly QA_SPACE_KEYS = ['QA', 'TESTING', 'QUALITY', 'TEST']; // Common QA space patterns
  private readonly QA_KEYWORDS = ['qa', 'quality', 'test', 'testing', 'defect', 'bug', 'regression'];
  
  // Development safety: restrict operations to QA space and MCP testing section
  private readonly DEVELOPMENT_SPACE = 'QA';
  private readonly MCP_TESTING_PARENT_ID = '3619127314'; // MCP test page ID
  private readonly ALLOWED_SPACE_FOR_UPDATES = 'QA';

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
          },
          {
            name: 'update_article',
            description: 'Update an existing Confluence article with new content (creates draft by default)',
            inputSchema: {
              type: 'object',
              properties: {
                pageId: { 
                  type: 'string', 
                  description: 'Page ID to update' 
                },
                newContent: { 
                  type: 'string', 
                  description: 'New content in markdown format' 
                },
                title: { 
                  type: 'string', 
                  description: 'Optional new title (keeps existing if not provided)' 
                },
                createDraft: { 
                  type: 'boolean', 
                  description: 'Create as draft (true) or publish immediately (false)', 
                  default: true 
                }
              },
              required: ['pageId', 'newContent']
            }
          },
          {
            name: 'preview_changes',
            description: 'Preview what changes will look like compared to current content',
            inputSchema: {
              type: 'object',
              properties: {
                pageId: { 
                  type: 'string', 
                  description: 'Page ID to preview changes for' 
                },
                newContent: { 
                  type: 'string', 
                  description: 'New content in markdown format' 
                }
              },
              required: ['pageId', 'newContent']
            }
          },
          {
            name: 'create_qa_draft',
            description: 'Create a new QA article draft in the appropriate QA space',
            inputSchema: {
              type: 'object',
              properties: {
                title: { 
                  type: 'string', 
                  description: 'Title for the new article' 
                },
                content: { 
                  type: 'string', 
                  description: 'Content in markdown format' 
                },
                spaceKey: { 
                  type: 'string', 
                  description: 'Optional space key (auto-detects QA space if not provided)' 
                }
              },
              required: ['title', 'content']
            }
          },
          {
            name: 'create_article',
            description: 'Create a new article in any space (creates draft by default)',
            inputSchema: {
              type: 'object',
              properties: {
                title: { 
                  type: 'string', 
                  description: 'Title for the new article' 
                },
                content: { 
                  type: 'string', 
                  description: 'Content in markdown format' 
                },
                spaceKey: { 
                  type: 'string', 
                  description: 'Space key where to create the article' 
                },
                parentId: { 
                  type: 'string', 
                  description: 'Optional parent page ID to create as child page' 
                },
                createDraft: { 
                  type: 'boolean', 
                  description: 'Create as draft (true) or publish immediately (false)', 
                  default: true 
                }
              },
              required: ['title', 'content', 'spaceKey']
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
          case 'update_article':
            return await this.updateArticle((args as any)?.pageId, (args as any)?.newContent, (args as any)?.title, (args as any)?.createDraft ?? true);
          case 'preview_changes':
            return await this.previewChanges((args as any)?.pageId, (args as any)?.newContent);
          case 'create_qa_draft':
            return await this.createQADraft((args as any)?.title, (args as any)?.content, (args as any)?.spaceKey);
          case 'create_article':
            return await this.createArticle((args as any)?.title, (args as any)?.content, (args as any)?.spaceKey, (args as any)?.parentId, (args as any)?.createDraft ?? true);
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
      // First, try to find QA-specific spaces
      const spaces = await this.confluence.getSpaces('global', 50);
      const qaSpaces = spaces.results.filter(space => 
        this.QA_SPACE_KEYS.some(keyword => 
          space.key.toUpperCase().includes(keyword) || 
          space.name.toUpperCase().includes(keyword.toUpperCase())
        )
      );

      let results;
      if (qaSpaces.length > 0) {
        // Search in QA spaces first
        const spaceKeys = qaSpaces.map(s => s.key).join('", "');
        const cql = `type=page AND space.key in ("${spaceKeys}")`;
        results = await this.confluence.searchContent(cql, limit);
      } else {
        // Fallback: search for QA-related content by keywords
        const qaKeywords = this.QA_KEYWORDS.join(' OR ');
        const cql = `type=page AND (title ~ "${qaKeywords}" OR text ~ "${qaKeywords}")`;
        results = await this.confluence.searchContent(cql, limit);
      }
      
      if (results.results.length === 0) {
        return {
          content: [{ 
            type: 'text', 
            text: '❌ No QA articles found. Try using search_pages with specific QA keywords.' 
          }]
        };
      }

      const pageList = results.results.slice(0, limit).map((result: any, index) => {
        const page = result.content || result;
        const fullUrl = this.getFullUrl(page._links?.webui || '');
        const spaceInfo = page.space ? ` [${page.space.key}]` : '';
        return `${index + 1}. **${page.title}**${spaceInfo} (ID: ${page.id})\n   🔗 [Open in Confluence](${fullUrl})\n`;
      }).join('\n');

      const qaSpaceInfo = qaSpaces.length > 0 ? 
        `\n🎯 **Found QA spaces**: ${qaSpaces.map(s => s.key).join(', ')}\n` : 
        '\n💡 **Note**: No dedicated QA spaces found, showing QA-related content.\n';

      return {
        content: [{
          type: 'text',
          text: `🎯 Found ${Math.min(results.results.length, limit)} QA articles:${qaSpaceInfo}\n${pageList}\n💡 Use 'read_article' with a page ID to read the full content.`
        }]
      };
    } catch (error: any) {
      throw new Error(`Failed to find QA articles: ${error.message}`);
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

  private convertMarkdownToConfluenceStorage(markdown: string): string {
    // Basic markdown to Confluence storage format conversion
    return markdown
      .replace(/^## (.*$)/gm, '<h2>$1</h2>')
      .replace(/^### (.*$)/gm, '<h3>$1</h3>')
      .replace(/^#### (.*$)/gm, '<h4>$1</h4>')
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      .replace(/^• (.*$)/gm, '<li>$1</li>')
      .replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>')
      .replace(/\n\n/g, '</p><p>')
      .replace(/^(?!<[h|u|l|p])/gm, '<p>')
      .replace(/(?<!>)$/gm, '</p>')
      .replace(/<p><\/p>/g, '')
      .replace(/<p>(<[hul])/g, '$1')
      .replace(/(<\/[hul]>)<\/p>/g, '$1');
  }

  private async validateDevelopmentSafety(pageId?: string, spaceKey?: string): Promise<void> {
    // During development, restrict operations to QA space only
    if (spaceKey && spaceKey !== this.ALLOWED_SPACE_FOR_UPDATES) {
      throw new Error(`🚫 Development Safety: Operations restricted to '${this.ALLOWED_SPACE_FOR_UPDATES}' space only. Requested: '${spaceKey}'`);
    }

    // If updating existing page, verify it's in allowed space
    if (pageId) {
      try {
        const page = await this.confluence.getPage(pageId);
        if (page.space?.key !== this.ALLOWED_SPACE_FOR_UPDATES) {
          throw new Error(`🚫 Development Safety: Can only update pages in '${this.ALLOWED_SPACE_FOR_UPDATES}' space. Page ${pageId} is in '${page.space?.key}' space.`);
        }
      } catch (error: any) {
        throw new Error(`Failed to validate page safety: ${error.message}`);
      }
    }
  }

  private async updateArticle(pageId: string, newContent: string, title?: string, createDraft: boolean = true) {
    if (!pageId || !newContent) {
      throw new Error('Page ID and new content are required');
    }

    try {
      // Development safety check
      await this.validateDevelopmentSafety(pageId);

      // Get current page to preserve title and get version
      const currentPage = await this.confluence.getPage(pageId);
      const pageTitle = title || currentPage.title;
      const currentVersion = currentPage.version?.number || 1;
      
      // Convert markdown to Confluence storage format
      const confluenceContent = this.convertMarkdownToConfluenceStorage(newContent);
      
      const status = createDraft ? 'draft' : 'current';
      const updatedPage = await this.confluence.updatePage(
        pageId, 
        pageTitle, 
        confluenceContent, 
        currentVersion,
        status
      );

      const statusText = createDraft ? 'draft created' : 'published';
      const fullUrl = this.getFullUrl(updatedPage._links?.webui || `spaces/${currentPage.space?.key}/pages/${pageId}`);

      return {
        content: [{
          type: 'text',
          text: `✅ Article "${pageTitle}" ${statusText} successfully!\n\n**Details:**\n• 📄 Page ID: ${pageId}\n• 📝 Version: ${updatedPage.version?.number || 'Unknown'}\n• 📊 Status: ${status}\n• 🏠 Space: ${currentPage.space?.key} (Development Safe)\n• 🔗 [View in Confluence](${fullUrl})\n\n${createDraft ? '💡 **Note**: This is a draft. Use publish controls in Confluence to make it live.' : '🚀 **Published**: Changes are now live.'}`
        }]
      };
    } catch (error: any) {
      throw new Error(`Failed to update article: ${error.message}`);
    }
  }

  private async previewChanges(pageId: string, newContent: string) {
    if (!pageId || !newContent) {
      throw new Error('Page ID and new content are required');
    }

    try {
      // Get current page content
      const currentPage = await this.confluence.getPage(pageId);
      const currentContent = currentPage.body?.storage?.value || 'No content';
      
      // Clean up current content for comparison
      const cleanCurrent = currentContent
        .replace(/<[^>]*>/g, '')
        .replace(/\n\s*\n/g, '\n\n')
        .trim();

      const previewContent = newContent.trim();
      
      // Simple diff indication
      const isSame = cleanCurrent === previewContent;
      const lengthDiff = previewContent.length - cleanCurrent.length;
      
      let preview = `🔍 **Preview Changes for "${currentPage.title}"**\n\n`;
      preview += `**📊 Summary:**\n`;
      preview += `• Current length: ${cleanCurrent.length} characters\n`;
      preview += `• New length: ${previewContent.length} characters\n`;
      preview += `• Change: ${lengthDiff > 0 ? '+' : ''}${lengthDiff} characters\n`;
      preview += `• Status: ${isSame ? '🟰 No changes detected' : '🔄 Changes detected'}\n\n`;
      
      if (!isSame) {
        preview += `**📝 New Content Preview:**\n`;
        preview += `\`\`\`\n${previewContent.substring(0, 500)}${previewContent.length > 500 ? '...' : ''}\n\`\`\`\n\n`;
        preview += `💡 **Next Steps:**\n`;
        preview += `• Use 'update_article' with createDraft=true to create a draft\n`;
        preview += `• Use 'update_article' with createDraft=false to publish immediately\n`;
      }

      return {
        content: [{
          type: 'text',
          text: preview
        }]
      };
    } catch (error: any) {
      throw new Error(`Failed to preview changes: ${error.message}`);
    }
  }

  private async createQADraft(title: string, content: string, spaceKey?: string) {
    if (!title || !content) {
      throw new Error('Title and content are required');
    }

    try {
      // Default to development-safe QA space
      let targetSpaceKey = spaceKey || this.DEVELOPMENT_SPACE;
      
      // Development safety check
      await this.validateDevelopmentSafety(undefined, targetSpaceKey);

      // Auto-detect QA space if not provided (but prioritize development space)
      if (!spaceKey) {
        targetSpaceKey = this.DEVELOPMENT_SPACE; // Always use QA space during development
      }
      
      // Convert markdown to Confluence storage format
      const confluenceContent = this.convertMarkdownToConfluenceStorage(content);
      
      // Always create under MCP testing section for development safety
      const newPage = await this.confluence.createPageDraft(
        targetSpaceKey, 
        title, 
        confluenceContent, 
        this.MCP_TESTING_PARENT_ID
      );
      const fullUrl = this.getFullUrl(newPage._links?.webui || `spaces/${targetSpaceKey}/pages/${newPage.id}`);

      return {
        content: [{
          type: 'text',
          text: `✅ QA article draft "${title}" created successfully!\n\n**Details:**\n• 📄 Page ID: ${newPage.id}\n• 🏠 Space: ${targetSpaceKey} (Development Safe)\n• 📝 Status: Draft\n• 👨‍👩‍👧‍👦 Parent: MCP testing section\n• 🔗 [View in Confluence](${fullUrl})\n\n💡 **Note**: This is a draft in the MCP testing section. Use Confluence's publish controls to make it live when ready.`
        }]
      };
    } catch (error: any) {
      throw new Error(`Failed to create QA draft: ${error.message}`);
    }
  }

  private async createArticle(title: string, content: string, spaceKey: string, parentId?: string, createDraft: boolean = true) {
    if (!title || !content || !spaceKey) {
      throw new Error('Title, content, and spaceKey are required');
    }

    try {
      // Development safety check
      await this.validateDevelopmentSafety(undefined, spaceKey);

      // Default to MCP testing parent if no parent specified and we're in QA space
      const effectiveParentId = (spaceKey === this.DEVELOPMENT_SPACE && !parentId) 
        ? this.MCP_TESTING_PARENT_ID 
        : parentId;

      // Convert markdown to Confluence storage format
      const confluenceContent = this.convertMarkdownToConfluenceStorage(content);
      
      if (createDraft) {
        // Create as draft
        const newPage = await this.confluence.createPageDraft(spaceKey, title, confluenceContent, effectiveParentId);
        const fullUrl = this.getFullUrl(newPage._links?.webui || `spaces/${spaceKey}/pages/${newPage.id}`);

        const parentInfo = effectiveParentId === this.MCP_TESTING_PARENT_ID 
          ? '👨‍👩‍👧‍👦 Parent: MCP testing section (Development Safe)\n' 
          : effectiveParentId ? `👨‍👩‍👧‍👦 Parent: ${effectiveParentId}\n` : '';

        return {
          content: [{
            type: 'text',
            text: `✅ Article draft "${title}" created successfully!\n\n**Details:**\n• 📄 Page ID: ${newPage.id}\n• 🏠 Space: ${spaceKey} (Development Safe)\n• 📝 Status: Draft\n${parentInfo}• 🔗 [View in Confluence](${fullUrl})\n\n💡 **Note**: This is a draft. Use Confluence's publish controls to make it live when ready.`
          }]
        };
      } else {
        // Create and publish immediately - we need to add this to the client
        throw new Error('Direct publishing not yet implemented. Please use createDraft=true and publish manually in Confluence.');
      }
    } catch (error: any) {
      throw new Error(`Failed to create article: ${error.message}`);
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