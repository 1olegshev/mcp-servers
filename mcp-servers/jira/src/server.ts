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

  // Domain JQL mappings for deployment slices
  private readonly DOMAIN_QUERIES: Record<string, string> = {
    frontend: '(project = KAHOOT AND labels in (kahoot-frontend))',
    backend: '(project = BACK)',
    wordpress: '(project = OPT)'
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
      baseUrl: (process.env.JIRA_BASE_URL || '').trim().replace(/\r\n?/g, ''),
      email: (process.env.JIRA_EMAIL || '').trim().replace(/\r\n?/g, ''),
      apiToken: (process.env.JIRA_API_TOKEN || '').trim().replace(/\r\n?/g, '')
    };

    console.error('Jira config:', {
      baseUrl: config.baseUrl,
      email: config.email,
      hasToken: !!config.apiToken
    });

    if (!config.baseUrl || !config.email || !config.apiToken) {
      console.error('❌ Missing Jira configuration');
      console.error('Please set JIRA_BASE_URL, JIRA_EMAIL, and JIRA_API_TOKEN in .env');
      process.exit(1);
    }

    return new JiraClient(config);
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

  private formatSuccessResponse(message: string, content?: string): any {
    return {
      content: [{
        type: 'text',
        text: content ? `⚡ ${message}:\n\n${content}` : `✅ ${message}`
      }]
    };
  }

  private formatErrorResponse(message: string): any {
    return {
      content: [{
        type: 'text',
        text: `❌ ${message}`
      }]
    };
  }

  private setupHandlers(): void {
    // Handle tools/list
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          // Keep the tool list focused on testing progress
          {
            name: 'get_testing_summary',
            description: 'Summarize counts for In QA, Testing, Test Passed on board scope, optionally per domain (frontend/backend/wordpress/other). NoTest excluded by default.',
            inputSchema: {
              type: 'object',
              properties: {
                boardId: { type: 'number', description: 'Jira board id', default: 23 },
                domain: { type: 'string', description: 'all | frontend | backend | wordpress | other', default: 'all' },
                separateNoTest: { type: 'boolean', description: 'If true, adds a separate NoTest counts block', default: false }
              },
              required: []
            }
          },
          {
            name: 'get_testing_remaining',
            description: 'List tickets remaining in testing or QA on board scope. Conditional defaults: when separateNoTest=true defaults to ["In QA", "Testing"], otherwise defaults to ["Testing"].',
            inputSchema: {
              type: 'object',
              properties: {
                boardId: { type: 'number', description: 'Jira board id', default: 23 },
                domain: { type: 'string', description: 'all | frontend | backend | wordpress | other', default: 'all' },
                statuses: { type: 'array', description: 'Statuses to include (e.g., ["In QA", "Testing"])', items: { type: 'string' }, default: [] },
                limit: { type: 'number', description: 'Max results to list', default: 50 },
                separateNoTest: { type: 'boolean', description: 'If true, shows a separate section for NoTest items in same scope', default: false }
              },
              required: []
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
                  default: 50 
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
          }
        ]
      };
    });

    // Handle tools/call
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case 'search_issues':
            return await this.searchIssues((args as any)?.jql, (args as any)?.limit || 50, (args as any)?.includeNoTest || false);
          case 'get_team_tickets':
            return await this.getTeamTickets((args as any)?.team, (args as any)?.status || 'In QA', (args as any)?.limit || 20);
          case 'get_issue_details':
            return await this.getIssueDetails((args as any)?.issueKey);
          case 'get_testing_summary':
            return await this.getTestingSummary((args as any)?.boardId ?? 23, (args as any)?.domain ?? 'all', (args as any)?.separateNoTest ?? false);
          case 'get_testing_remaining':
            return await this.getTestingRemaining((args as any)?.boardId ?? 23, (args as any)?.domain ?? 'all', (args as any)?.statuses, (args as any)?.limit ?? 50, (args as any)?.separateNoTest ?? false);
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

  private buildDomainJql(domain: string): string {
    const d = (domain || 'all').toLowerCase();
    if (d === 'all') return '';
    if (d in this.DOMAIN_QUERIES) return this.DOMAIN_QUERIES[d];
    if (d === 'other') {
      // NOT (backend OR wordpress OR frontend)
      const notExpr = `NOT ((project = BACK) OR (project = OPT) OR (project = KAHOOT AND labels in (kahoot-frontend)))`;
      return `(${notExpr})`;
    }
    // Unknown domain: return empty (no domain filter) to avoid breaking
    return '';
  }

  private buildStatusesJql(statuses: string[]): string {
    const list = (statuses || []).map(s => `"${s}"`).join(', ');
    return list ? `status in (${list})` : '';
  }

  private buildRobustJql(parts: string[], excludeNoTest: boolean): string {
    // Filter out empty parts, clean them
    const cleanParts = parts
      .filter(p => p && p.trim())
      .map(part => part.replace(/\s+ORDER\s+BY\s+.+$/i, '').trim())
      .filter(Boolean);
      
    if (excludeNoTest) {
        const quotedLabels = this.NO_TEST_LABELS.map(label => `"${label}"`).join(', ');
        const noTestFilter = `(labels not in (${quotedLabels}) OR labels is EMPTY)`;
        cleanParts.push(noTestFilter);
    }

    if (cleanParts.length === 0) return '';
    
    // Wrap each part in parentheses and join with AND for safety
    return cleanParts.map(part => `(${part})`).join(' AND ');
  }

  private async getTestingSummary(boardId: number, domain: string, separateNoTest: boolean) {
    try {
      const baseJql = await this.jira.getBoardFilterJql(boardId);
      const domainJql = this.buildDomainJql(domain);
      const statuses = ['In QA', 'Testing', 'Test Passed'];
      const statusJql = this.buildStatusesJql(statuses);

      // Build JQL, assuming board filter handles NoTest exclusion
      const filteredJql = this.buildRobustJql([baseJql, domainJql, statusJql], false);

      // Fetch issues up to a reasonable cap and count client-side
      const results = await this.jira.searchIssues(filteredJql, 200);
      const issues = results.issues || [];
      const counts = { inqa: 0, testing: 0, passed: 0 };
      for (const issue of issues) {
        const s = issue.fields.status?.name || '';
        if (s === 'In QA') counts.inqa++;
        else if (s === 'Testing') counts.testing++;
        else if (s === 'Test Passed') counts.passed++;
      }
      const total = counts.inqa + counts.testing + counts.passed;

      let lines: string[] = [];
      const label = domain === 'all' ? 'Overall' : domain.charAt(0).toUpperCase() + domain.slice(1);
      lines.push(`• ${label}: In QA ${counts.inqa} | Testing ${counts.testing} | Test Passed ${counts.passed} | Total ${total}`);

      if (domain === 'all') {
        // Add per-domain lines
        for (const d of ['frontend', 'backend', 'wordpress', 'other']) {
          const dj = this.buildDomainJql(d);
          const jf = this.buildRobustJql([baseJql, dj, statusJql], false);
          const res = await this.jira.searchIssues(jf, 200);
          const c = { inqa: 0, testing: 0, passed: 0 };
          for (const issue of res.issues || []) {
            const s = issue.fields.status?.name || '';
            if (s === 'In QA') c.inqa++;
            else if (s === 'Testing') c.testing++;
            else if (s === 'Test Passed') c.passed++;
          }
          const t = c.inqa + c.testing + c.passed;
          const name = d.charAt(0).toUpperCase() + d.slice(1);
          lines.push(`  - ${name}: In QA ${c.inqa} | Testing ${c.testing} | Test Passed ${c.passed} | Total ${t}`);
        }
      }

      if (separateNoTest) {
        const noTestLabelsJql = `labels in (${this.NO_TEST_LABELS.map(l => `"${l}"`).join(',')})`;
        const noTestJql = this.buildRobustJql([baseJql, domainJql, statusJql, noTestLabelsJql], false);
        const noTestRes = await this.jira.searchIssues(noTestJql, 200);
        const n = { inqa: 0, testing: 0, passed: 0 };
        for (const issue of noTestRes.issues || []) {
          const s = issue.fields.status?.name || '';
          if (s === 'In QA') n.inqa++;
          else if (s === 'Testing') n.testing++;
          else if (s === 'Test Passed') n.passed++;
        }
        const t = n.inqa + n.testing + n.passed;
        lines.push(`• NoTest (separate): In QA ${n.inqa} | Testing ${n.testing} | Test Passed ${n.passed} | Total ${t}`);
      }

      return this.formatSuccessResponse('Testing summary', lines.join('\n'));
    } catch (error: any) {
      throw new Error(`Failed to get testing summary: ${error.message}`);
    }
  }

  private async getTestingRemaining(boardId: number, domain: string, statuses: string[], limit: number, separateNoTest: boolean) {
    // Conditional defaults for statuses based on separateNoTest flag
    if (!Array.isArray(statuses) || statuses.length === 0) {
      statuses = separateNoTest ? ['In QA', 'Testing'] : ['Testing'];
    }
    try {
      let message: string;
      let content: string;

      if (separateNoTest) {
        // --- Strategy for including NoTest tickets ---
        // Build two simple, separate JQL queries from scratch to avoid board filter complexity.
        const statusJql = this.buildStatusesJql(statuses);
        const domainJql = this.buildDomainJql(domain);
        
        // 1. Query for regular tickets (NoTest excluded, only KAHOOT, BACK, OPT projects)
        const projectFilterJql = `project in (KAHOOT, BACK, OPT)`;
        const regularJql = this.buildRobustJql([statusJql, domainJql, projectFilterJql], true);
        const regularResults = await this.jira.searchIssues(regularJql, limit);
        const regularList = regularResults.issues.length > 0 ? this.formatIssueList(regularResults.issues) : 'None';

        // 2. Query for NoTest tickets (only KAHOOT, BACK, OPT projects)
        const noTestLabelsJql = `labels in ("${this.NO_TEST_LABELS.join('", "')}")`;
        const noTestJql = this.buildRobustJql([statusJql, domainJql, noTestLabelsJql, projectFilterJql], false);
        const noTestResults = await this.jira.searchIssues(noTestJql, limit);
        const noTestList = noTestResults.issues.length > 0 ? this.formatIssueList(noTestResults.issues) : 'None';

        const totalFound = regularResults.issues.length + noTestResults.issues.length;
        message = `Found ${totalFound} ticket(s) in ${statuses.join(', ')}`;
        content = `Regular tickets (${regularResults.issues.length}):\n${regularList}\n\nNoTest tickets (${noTestResults.issues.length}):\n${noTestList}`;

      } else {
        // --- Strategy for default case (using board filter) ---
        // Use the board's filter but reliably strip the ORDER BY clause.
        const baseJql = await this.jira.getBoardFilterJql(boardId);
        const domainJql = this.buildDomainJql(domain);
        const statusJql = this.buildStatusesJql(statuses);
        
        // Build the query. Assume board JQL handles NoTest, so pass `false`.
        const scopedJql = this.buildRobustJql([baseJql, domainJql, statusJql], false);
        
        const results = await this.jira.searchIssues(scopedJql, limit);

        if ((results.issues || []).length === 0) {
          return this.formatErrorResponse('No tickets found for the requested testing scope');
        }
        
        message = `Found ${results.issues.length} ticket(s) in ${statuses.join(', ')} on board ${boardId}`;
        content = this.formatIssueList(results.issues);
      }

      return this.formatSuccessResponse(message, content);
    } catch (error: any) {
      throw new Error(`Failed to get testing remaining: ${error.message}`);
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
      const statusJql = `status = "${status}"`;
      const filteredJql = this.buildRobustJql([statusJql, teamQuery], true);
      const results = await this.jira.searchIssues(filteredJql, limit);

      if (results.issues.length === 0) {
        return this.formatErrorResponse(`No tickets found for ${team} team in "${status}" status`);
      }

      const issueList = this.formatIssueList(results.issues);
      return this.formatSuccessResponse(`Found ${results.issues.length} tickets for ${team} team in "${status}" status`, issueList);
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
      const filteredJql = this.buildRobustJql([expandedJql], !includeNoTest);
      const results = await this.jira.searchIssues(filteredJql, limit);

      if (results.issues.length === 0) {
        const noTestNote = includeNoTest ? '' : ' (NoTest labeled tickets excluded by default)';
        return this.formatErrorResponse(`No issues found for JQL: ${filteredJql}${noTestNote}`);
      }

      const issueList = this.formatIssueList(results.issues);
      return this.formatSuccessResponse(`Found ${results.issues.length} issues`, issueList);
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

      const details = `**${issue.key}**: ${issue.fields.summary}

**📋 Details:**
• 🔹 Status: ${issue.fields.status.name}
• 👤 Assignee: ${issue.fields.assignee?.displayName || 'Unassigned'}
• 👨‍💻 Reporter: ${issue.fields.reporter.displayName}
• 🔥 Priority: ${issue.fields.priority.name}
• 📝 Type: ${issue.fields.issuetype.name}
• 🏷️ Labels: ${labels}
• 🧩 Components: ${components}
• 📅 Created: ${new Date(issue.fields.created).toLocaleDateString()}
• ⏰ Updated: ${new Date(issue.fields.updated).toLocaleDateString()}
• 🔗 [Open in Jira](${issueUrl})`;

      return this.formatSuccessResponse(`Issue details for ${issue.key}`, details);
    } catch (error: any) {
      throw new Error(`Failed to get issue details: ${error.message}`);
    }
  }

  async run(): Promise<void> {
    try {
      // Test connection first
      await this.jira.testConnection();
      console.error('✅ Jira connection successful');

      const transport = new StdioServerTransport();
      await this.server.connect(transport);
      console.error('🚀 Jira MCP server running on stdio');
    } catch (error: any) {
      console.error('❌ Failed to start server:', error.message);
      process.exit(1);
    }
  }
}

// Start the server
const server = new JiraMCPServer();
server.run();
