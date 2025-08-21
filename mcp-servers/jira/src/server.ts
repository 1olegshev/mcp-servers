#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import dotenv from 'dotenv';
import { JiraClient } from './jira-client.js';
import { JiraConfig } from './types.js';

// Load environment variables from parent directory
dotenv.config({ path: '../../.env' });

class JiraMCPServer {
  private server: Server;
  private jira: JiraClient;
  private baseUrl: string;
  private readonly NO_TEST_LABELS = ['NoTest', 'no-test', 'notest', 'noTest', 'Notest'];
  private readonly TEAM_QUERIES: Record<string, string> = {
    'commercial': 'project = "Online and Projects Team" OR labels in (coreteam3, Coreteam3, commercial, Commercial, onlineteam, onlineteam_IPM, marketplace, kahoot-remix)',
    'onlineteam': 'project = "Online and Projects Team" OR labels in (coreteam3, Coreteam3, commercial, Commercial, onlineteam, onlineteam_IPM, marketplace, kahoot-remix)',
    'marketplace': 'project = "Online and Projects Team" OR labels in (coreteam3, Coreteam3, commercial, Commercial, onlineteam, onlineteam_IPM, marketplace, kahoot-remix)',
    'skynetteam': 'labels in (SkynetTeam)',
    'puzzlesteam': 'project = "DragonBox Labs and Puzzles" OR labels in (PuzzlesTeam)',
    'gamefactory': 'labels in (engaging-learning, GameFactory)',
    'corporate': 'labels in (corporate-learning, coreteamx, KahootX)'
  };

  constructor() {
    this.server = new Server(
      {
        name: 'jira-mcp-server',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.jira = this.initializeJira();
    this.baseUrl = process.env.JIRA_BASE_URL || '';
    this.setupHandlers();
  }

  private initializeJira(): JiraClient {
    const config: JiraConfig = {
      baseUrl: process.env.JIRA_BASE_URL || '',
      email: process.env.JIRA_EMAIL || '',
      apiToken: process.env.JIRA_API_TOKEN || '',
    };

    if (!config.baseUrl || !config.email || !config.apiToken) {
      console.error('❌ Missing Jira configuration');
      console.error('Please set JIRA_BASE_URL, JIRA_EMAIL, and JIRA_API_TOKEN in .env');
      process.exit(1);
    }

    return new JiraClient(config);
  }

  private getFullUrl(relativePath: string): string {
    if (!relativePath) return 'N/A';
    if (relativePath.startsWith('http')) return relativePath;
    
    const cleanPath = relativePath.startsWith('/') ? relativePath.slice(1) : relativePath;
    return `${this.baseUrl}/${cleanPath}`;
  }

  private addNoTestFilter(jql: string, includeNoTest: boolean = false): string {
    if (includeNoTest) {
      return jql; // Return original JQL if including NoTest tickets
    }
    
    // Add NoTest exclusion filter
    const noTestFilter = `(labels not in (${this.NO_TEST_LABELS.join(', ')}) OR labels is EMPTY)`;
    
    if (jql.trim()) {
      return `(${jql}) AND ${noTestFilter}`;
    } else {
      return noTestFilter;
    }
  }

  private expandTeamLabels(jql: string): string {
    let expandedJql = jql;
    
    // Replace team references with their full query
    for (const [teamName, teamQuery] of Object.entries(this.TEAM_QUERIES)) {
      // Match patterns like: labels = "teamname" or labels = "teamnameTeam"
      const patterns = [
        new RegExp(`labels\\s*=\\s*"${teamName}"`, 'gi'),
        new RegExp(`labels\\s*=\\s*"${teamName}team"`, 'gi'),
        new RegExp(`labels\\s*=\\s*"${teamName}Team"`, 'gi')
      ];
      
      patterns.forEach(pattern => {
        if (pattern.test(expandedJql)) {
          const replacement = `(${teamQuery})`;
          expandedJql = expandedJql.replace(pattern, replacement);
        }
      });
    }
    
    return expandedJql;
  }

  private formatIssueList(issues: any[]): string {
    return issues.map((issue, index) => {
      const assignee = issue.fields.assignee?.displayName || 'Unassigned';
      const status = issue.fields.status.name;
      const priority = issue.fields.priority?.name || 'None';
      const labels = issue.fields.labels?.slice(0, 2).join(', ') || '';
      const components = issue.fields.components?.slice(0, 1).map((c: any) => c.name).join(', ') || '';
      const issueUrl = `${this.baseUrl}/browse/${issue.key}`;
      
      const labelsText = labels ? ` | 🏷️ ${labels}` : '';
      const componentsText = components ? ` | 🧩 ${components}` : '';
      
      return `${index + 1}. **${issue.key}** - ${issue.fields.summary}
   🔹 ${status} | 🔥 ${priority} | 👤 ${assignee}${labelsText}${componentsText} | 🔗 [Open](${issueUrl})`;
    }).join('\n\n---\n\n');
  }

  private setupHandlers(): void {
    // Handle tools/list
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: 'get_testing_board_issues',
            description: 'Get issues from the testing board',
            inputSchema: {
              type: 'object',
              properties: {
                boardId: { 
                  type: 'number', 
                  description: 'Testing board ID' 
                },
                limit: { 
                  type: 'number', 
                  description: 'Max issues to return', 
                  default: 20 
                }
              },
              required: ['boardId']
            }
          },
          {
            name: 'search_issues',
            description: 'Search for Jira issues using JQL. By default excludes NoTest labeled tickets unless includeNoTest is true. Automatically expands team names (e.g., "commercial" → coreteam3, Commercial, commercial).',
            inputSchema: {
              type: 'object',
              properties: {
                jql: { 
                  type: 'string', 
                  description: 'JQL query string' 
                },
                limit: { 
                  type: 'number', 
                  description: 'Max results', 
                  default: 20 
                },
                includeNoTest: {
                  type: 'boolean',
                  description: 'Include tickets with NoTest labels (default: false)',
                  default: false
                }
              },
              required: ['jql']
            }
          },
          {
            name: 'get_team_tickets',
            description: 'Get tickets for a specific team in a given status. Automatically handles team label mapping.',
            inputSchema: {
              type: 'object',
              properties: {
                team: {
                  type: 'string',
                  description: 'Team name (commercial, marketplace, skynetteam, puzzlesteam, gamefactory, onlineteam, coreteam, corporate)'
                },
                status: {
                  type: 'string',
                  description: 'Ticket status (e.g., "In QA", "Test Passed", "Open")',
                  default: 'In QA'
                },
                limit: {
                  type: 'number',
                  description: 'Max results',
                  default: 20
                }
              },
              required: ['team']
            }
          },
          {
            name: 'get_issue_details',
            description: 'Get detailed information about a specific issue',
            inputSchema: {
              type: 'object',
              properties: {
                issueKey: { 
                  type: 'string', 
                  description: 'Issue key (e.g., PROJ-123)' 
                }
              },
              required: ['issueKey']
            }
          },
          {
            name: 'get_boards',
            description: 'List all available Jira boards',
            inputSchema: {
              type: 'object',
              properties: {
                limit: { 
                  type: 'number', 
                  description: 'Max boards to return', 
                  default: 20 
                }
              }
            }
          },
          {
            name: 'update_issue_labels',
            description: 'Update labels on a Jira issue',
            inputSchema: {
              type: 'object',
              properties: {
                issueKey: { 
                  type: 'string', 
                  description: 'Issue key (e.g., PROJ-123)' 
                },
                labels: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'Array of label names to add'
                }
              },
              required: ['issueKey', 'labels']
            }
          },
          {
            name: 'update_issue_components',
            description: 'Update components on a Jira issue',
            inputSchema: {
              type: 'object',
              properties: {
                issueKey: { 
                  type: 'string', 
                  description: 'Issue key (e.g., PROJ-123)' 
                },
                componentIds: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'Array of component IDs'
                }
              },
              required: ['issueKey', 'componentIds']
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
          case 'get_testing_board_issues':
            return await this.getTestingBoardIssues((args as any)?.boardId, (args as any)?.limit || 20);
          case 'search_issues':
            return await this.searchIssues((args as any)?.jql, (args as any)?.limit || 20, (args as any)?.includeNoTest || false);
          case 'get_team_tickets':
            return await this.getTeamTickets((args as any)?.team, (args as any)?.status || 'In QA', (args as any)?.limit || 20);
          case 'get_issue_details':
            return await this.getIssueDetails((args as any)?.issueKey);
          case 'get_boards':
            return await this.getBoards();
          case 'update_issue_labels':
            return await this.updateIssueLabels((args as any)?.issueKey, (args as any)?.labels);
          case 'update_issue_components':
            return await this.updateIssueComponents((args as any)?.issueKey, (args as any)?.componentIds);
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

  private async getTestingBoardIssues(boardId: number, limit: number) {
    try {
      const results = await this.jira.getBoardIssues(boardId, limit);
      
      if (results.issues.length === 0) {
        return {
          content: [{ 
            type: 'text', 
            text: `❌ No issues found on board ${boardId}` 
          }]
        };
      }

      const issueList = this.formatIssueList(results.issues);

      return {
        content: [{
          type: 'text',
          text: `��� Found ${results.issues.length} issues on testing board:\n\n${issueList}`
        }]
      };
    } catch (error: any) {
      throw new Error(`Failed to get board issues: ${error.message}`);
    }
  }

  private async getTeamTickets(team: string, status: string, limit: number) {
    if (!team) {
      throw new Error('Team name is required');
    }

    const teamLower = team.toLowerCase();
    const teamQuery = this.TEAM_QUERIES[teamLower];
    
    if (!teamQuery) {
      const availableTeams = Object.keys(this.TEAM_QUERIES).join(', ');
      throw new Error(`Unknown team: ${team}. Available teams: ${availableTeams}`);
    }

    try {
      const jql = `status = "${status}" AND (${teamQuery})`;
      const filteredJql = this.addNoTestFilter(jql, false);
      const results = await this.jira.searchIssues(filteredJql, limit);

      if (results.issues.length === 0) {
        return {
          content: [{ 
            type: 'text', 
            text: `**0 tickets** for ${team} team in "${status}" status.` 
          }]
        };
      }

      const issueList = this.formatIssueList(results.issues);

      return {
        content: [{
          type: 'text',
          text: `**${results.issues.length} tickets** for ${team} team in "${status}" status:\n\n${issueList}`
        }]
      };
    } catch (error: any) {
      throw new Error(`Failed to get team tickets: ${error.message}`);
    }
  }

  private async searchIssues(jql: string, limit: number, includeNoTest: boolean = false) {
    if (!jql) {
      throw new Error('JQL query is required');
    }

    try {
      // First expand team labels, then apply NoTest filter
      const expandedJql = this.expandTeamLabels(jql);
      const filteredJql = this.addNoTestFilter(expandedJql, includeNoTest);
      const results = await this.jira.searchIssues(filteredJql, limit);

      if (results.issues.length === 0) {
        return {
          content: [{ 
            type: 'text', 
            text: `❌ No issues found for JQL: ${filteredJql}${includeNoTest ? '' : ' (NoTest labeled tickets excluded by default)'}` 
          }]
        };
      }

      const issueList = this.formatIssueList(results.issues);

      return {
        content: [{
          type: 'text',
          text: `��� Found ${results.issues.length} issues:\n\n${issueList}`
        }]
      };
    } catch (error: any) {
      throw new Error(`Failed to search issues: ${error.message}`);
    }
  }

  private async getIssueDetails(issueKey: string) {
    if (!issueKey) {
      throw new Error('Issue key is required');
    }

    try {
      const issue = await this.jira.getIssue(issueKey);
      const issueUrl = `${this.baseUrl}/browse/${issue.key}`;

      const labels = issue.fields.labels.length > 0 ? issue.fields.labels.join(', ') : 'None';
      const components = issue.fields.components.length > 0 
        ? issue.fields.components.map(c => c.name).join(', ') 
        : 'None';

      let response = `��� **${issue.key}**: ${issue.fields.summary}\n\n`;
      response += `**��� Details:**\n`;
      response += `• ��� Status: ${issue.fields.status.name}\n`;
      response += `• ��� Assignee: ${issue.fields.assignee?.displayName || 'Unassigned'}\n`;
      response += `• ���‍��� Reporter: ${issue.fields.reporter.displayName}\n`;
      response += `• ��� Priority: ${issue.fields.priority.name}\n`;
      response += `• ��� Type: ${issue.fields.issuetype.name}\n`;
      response += `• ���️ Labels: ${labels}\n`;
      response += `• ��� Components: ${components}\n`;
      response += `• ��� Created: ${new Date(issue.fields.created).toLocaleDateString()}\n`;
      response += `• ��� Updated: ${new Date(issue.fields.updated).toLocaleDateString()}\n`;
      response += `• ��� [Open in Jira](${issueUrl})\n`;

      return {
        content: [{ 
          type: 'text', 
          text: response 
        }]
      };
    } catch (error: any) {
      throw new Error(`Failed to get issue details: ${error.message}`);
    }
  }

  private async getBoards() {
    try {
      const boards = await this.jira.getBoards();

      const boardList = boards.values.map(board => {
        return `• **${board.name}** (ID: ${board.id}) - ${board.type}
  ��� Project: ${board.location.projectName} (${board.location.projectKey})`;
      }).join('\n');

      return {
        content: [{
          type: 'text',
          text: `��� Found ${boards.values.length} boards:\n\n${boardList}\n\n��� Use board IDs with 'get_testing_board_issues' to see specific board issues.`
        }]
      };
    } catch (error: any) {
      throw new Error(`Failed to get boards: ${error.message}`);
    }
  }

  private async updateIssueLabels(issueKey: string, labels: string[]) {
    if (!issueKey || !labels) {
      throw new Error('Issue key and labels are required');
    }

    try {
      await this.jira.updateIssueLabels(issueKey, labels);
      
      return {
        content: [{ 
          type: 'text', 
          text: `✅ Successfully updated labels for ${issueKey}: ${labels.join(', ')}` 
        }]
      };
    } catch (error: any) {
      throw new Error(`Failed to update labels: ${error.message}`);
    }
  }

  private async updateIssueComponents(issueKey: string, componentIds: string[]) {
    if (!issueKey || !componentIds) {
      throw new Error('Issue key and component IDs are required');
    }

    try {
      await this.jira.updateIssueComponents(issueKey, componentIds);
      
      return {
        content: [{ 
          type: 'text', 
          text: `✅ Successfully updated components for ${issueKey}` 
        }]
      };
    } catch (error: any) {
      throw new Error(`Failed to update components: ${error.message}`);
    }
  }

  async run(): Promise<void> {
    try {
      // Test connection first
      await this.jira.testConnection();
      console.error('✅ Jira connection successful');

      const transport = new StdioServerTransport();
      await this.server.connect(transport);
      console.error('��� Jira MCP server running on stdio');
    } catch (error: any) {
      console.error('❌ Failed to start server:', error.message);
      process.exit(1);
    }
  }
}

// Start the server
const server = new JiraMCPServer();
server.run();
