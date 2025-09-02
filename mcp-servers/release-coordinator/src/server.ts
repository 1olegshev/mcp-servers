#!/usr/bin/env node

/**
 * Release Coordinator MCP Server (format-only)
 * Minimal, stable base that formats a comprehensive release overview
 * from provided inputs. Orchestration (calling Jira/Slack) is expected to be
 * done by the MCP client or an external orchestrator, then passed here.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

interface OverviewArgs {
  jiraTestingSummary?: string;
  autoTestStatus?: string;
  blockingIssues?: string;
  date?: string; // ISO date or human label (e.g., "today")
  // Optional orchestration inputs (used when self-fetching)
  channel?: string; // Slack channel, default functional-testing
  boardId?: number; // Jira board id, default 23
  domain?: string; // Jira domain filter, default 'all'
  separateNoTest?: boolean; // Split NoTest in Jira summary
  // Optional: Post the overview to Slack
  postToSlack?: boolean; // default false; when true, post to #qa-release-status
}

export class ReleaseCoordinatorServer {
  private server: Server;
  private mcpConfig: any;

  constructor() {
    // Load MCP config to get tokens
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const mcpConfigPath = path.resolve(__dirname, '../../../.vscode/mcp.json');
    this.mcpConfig = JSON.parse(fs.readFileSync(mcpConfigPath, 'utf8'));

    this.server = new Server(
      { name: 'release-coordinator-mcp-server', version: '1.0.0' },
      { capabilities: { tools: {} } }
    );
    this.setupHandlers();
  }

  private setupHandlers(): void {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'get_comprehensive_release_overview',
          description:
            'Comprehensive release overview. If inputs are omitted, the coordinator will call Jira/Slack MCP servers internally to fetch them.',
          inputSchema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              jiraTestingSummary: { type: 'string', description: 'Markdown or text from Jira get_testing_summary' },
              autoTestStatus: { type: 'string', description: 'Markdown or text from Slack get_auto_test_status' },
              blockingIssues: { type: 'string', description: 'Markdown or text from Slack get_blocking_issues' },
              date: { type: 'string', description: 'Date label to show in the header (e.g., 2025-09-01 or “today”)' },
              channel: { type: 'string', description: 'Slack channel to analyze (defaults to functional-testing)' },
              boardId: { type: 'number', description: 'Jira board id (defaults to 23)' },
              domain: { type: 'string', description: 'Jira domain: all | frontend | backend | wordpress | other (defaults to all)' },
              separateNoTest: { type: 'boolean', description: 'Jira: show separate NoTest counts', default: false },
              postToSlack: { type: 'boolean', description: 'If true, posts the overview to #qa-release-status', default: false },
            },
            required: [],
          },
        },
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      switch (request.params.name) {
        case 'get_comprehensive_release_overview':
          return this.handleGetComprehensiveReleaseOverview((request.params.arguments ?? {}) as OverviewArgs);
        default:
          throw new Error(`Unknown tool: ${request.params.name}`);
      }
    });
  }

  private async handleGetComprehensiveReleaseOverview(args: OverviewArgs) {
    // If inputs are not provided, orchestrate calls to Jira/Slack servers
    const [jiraSummary, autoStatus, blockers] = await this.fetchSectionsIfNeeded(args);

    const today = new Date();
    const dateLabel = args.date || today.toISOString().slice(0, 10);

    const testingBoardLink = 'https://mobitroll.atlassian.net/jira/software/c/projects/KAHOOT/boards/23';
    const response = `## 🚀 Release Status Overview — ${dateLabel}

### 📊 Manual Testing Status (Jira)
${jiraSummary}

Testing board: <${testingBoardLink}|KAHOOT Board #23>

### 🤖 Automated Test Status (Slack)
${autoStatus}

### 🚨 Blocking Issues (Slack)
${blockers}

---
Notes:
- Orchestrated by Release Coordinator. Sections may include Markdown with links from source servers.`;

        // Optionally post to Slack channel #qa-release-status (C09BW9Y2HSN)
    if (args.postToSlack) {
      try {
        const postResult = await this.callSlackSendMessage({ channel: 'C09BW9Y2HSN', text: response });
        console.error('Posted to Slack:', postResult);
        const postedNote = postResult ? `\n\nPosted to #qa-release-status.` : '';
        return { content: [{ type: 'text', text: response + postedNote }] };
      } catch (error) {
        console.error('Failed to post to Slack:', error);
        return { content: [{ type: 'text', text: response + '\n\nFailed to post to Slack.' }] };
      }
    }

    return { content: [{ type: 'text', text: response }] };
  }

  private async fetchSectionsIfNeeded(args: OverviewArgs): Promise<[string, string, string]> {
    const needsJira = !args.jiraTestingSummary;
    const needsAuto = !args.autoTestStatus;
    const needsBlockers = !args.blockingIssues;

    if (!needsJira && !needsAuto && !needsBlockers) {
      return [args.jiraTestingSummary!.trim(), args.autoTestStatus!.trim(), args.blockingIssues!.trim()];
    }

    // Defaults
    const channel = args.channel || 'functional-testing';
    const boardId = args.boardId ?? 23;
    const domain = args.domain || 'all';
    const separateNoTest = args.separateNoTest ?? false;
    const date = args.date || new Date().toISOString().slice(0, 10);

    const tasks: Array<Promise<string>> = [];
    const order: Array<'jira' | 'auto' | 'blockers'> = [];

    if (needsJira) {
      order.push('jira');
      tasks.push(this.callJiraGetTestingSummary({ boardId, domain, separateNoTest }));
    }
    if (needsAuto) {
      order.push('auto');
      tasks.push(this.callSlackGetAutoTestStatus({ channel, date }));
    }
    if (needsBlockers) {
      order.push('blockers');
      tasks.push(this.callSlackGetBlockingIssues({ channel, date }));
    }

    const results = await Promise.all(tasks);
    let jiraOut = args.jiraTestingSummary?.trim();
    let autoOut = args.autoTestStatus?.trim();
    let blockersOut = args.blockingIssues?.trim();
    for (let i = 0; i < order.length; i++) {
      const key = order[i];
      const val = results[i];
      if (key === 'jira') jiraOut = val;
      else if (key === 'auto') autoOut = val;
      else if (key === 'blockers') blockersOut = val;
    }

    return [
      jiraOut || '_Jira summary unavailable._',
      autoOut || '_Automated test status unavailable._',
      blockersOut || '_Blocking issues unavailable._',
    ];
  }

  // --- MCP client orchestration helpers ---
  private async callJiraGetTestingSummary(params: { boardId: number; domain: string; separateNoTest: boolean }): Promise<string> {
    const client = new Client({ name: 'release-coordinator', version: '1.0.0' });
    const transport = new StdioClientTransport({
      command: 'node',
      args: ['dist/server.js'],
      cwd: path.resolve(this.getDirname(), '../../jira'),
      env: this.buildEnv(),
    });
    await client.connect(transport);
    try {
      const result = await client.callTool({
        name: 'get_testing_summary',
        arguments: {
          boardId: params.boardId,
          domain: params.domain,
          separateNoTest: params.separateNoTest,
        },
      } as any);
      return this.extractTextContent(result) || '⚠️ Jira: empty response';
    } catch (e: any) {
      return `⚠️ Jira error: ${e?.message || String(e)}`;
    } finally {
      await client.close?.().catch(() => undefined);
    }
  }

  private async callSlackGetAutoTestStatus(params: { channel: string; date: string }): Promise<string> {
    const client = new Client({ name: 'release-coordinator', version: '1.0.0' });
    const transport = new StdioClientTransport({
      command: 'node',
      args: ['dist/server.js'],
      cwd: path.resolve(this.getDirname(), '../../slack'),
      env: this.buildEnv(),
    });
    await client.connect(transport);
    try {
      const result = await client.callTool({
        name: 'get_auto_test_status',
        arguments: { channel: params.channel, date: params.date },
      } as any);
      return this.extractTextContent(result) || '⚠️ Slack auto-test: empty response';
    } catch (e: any) {
      return `⚠️ Slack auto-test error: ${e?.message || String(e)}`;
    } finally {
      await client.close?.().catch(() => undefined);
    }
  }

  private async callSlackGetBlockingIssues(params: { channel: string; date: string }): Promise<string> {
    const client = new Client({ name: 'release-coordinator', version: '1.0.0' });
    const transport = new StdioClientTransport({
      command: 'node',
      args: ['dist/server.js'],
      cwd: path.resolve(this.getDirname(), '../../slack'),
      env: this.buildEnv(),
    });
    await client.connect(transport);
    try {
      const result = await client.callTool({
        name: 'get_blocking_issues',
        arguments: { channel: params.channel, date: params.date, severity: 'both' },
      } as any);
      return this.extractTextContent(result) || '⚠️ Slack blockers: empty response';
    } catch (e: any) {
      return `⚠️ Slack blockers error: ${e?.message || String(e)}`;
    } finally {
      await client.close?.().catch(() => undefined);
    }
  }

  private extractTextContent(result: any): string | null {
    const items = result?.content || [];
    const textItem = items.find((c: any) => c?.type === 'text' && typeof c.text === 'string');
    return textItem?.text || null;
  }

  private async callSlackSendMessage(params: { channel: string; text: string }): Promise<boolean> {
    const client = new Client({ name: 'release-coordinator', version: '1.0.0' });
    const transport = new StdioClientTransport({
      command: 'node',
      args: ['dist/server.js'],
      cwd: path.resolve(this.getDirname(), '../../slack'),
      env: this.buildEnv(),
    });
    await client.connect(transport);
    try {
      const result = await client.callTool({
        name: 'send_message',
        arguments: { channel: params.channel, text: params.text },
      } as any);
      // If Slack server returns a text, consider it success
      const ok = !!this.extractTextContent(result);
      return ok;
    } finally {
      await client.close?.().catch(() => undefined);
    }
  }

  private getDirname(): string {
    // Reconstruct __dirname in ESM context
    const __filename = fileURLToPath(import.meta.url);
    return path.dirname(__filename);
  }

  private buildEnv(): Record<string, string> {
    // Use tokens from mcp.json instead of process.env
    const slackEnv = this.mcpConfig.servers?.slack?.env || {};
    const jiraEnv = this.mcpConfig.servers?.jira?.env || {};
    const confluenceEnv = this.mcpConfig.servers?.confluence?.env || {};
    
    return {
      ...slackEnv,
      ...jiraEnv, 
      ...confluenceEnv
    };
  }

  async run(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('Release Coordinator MCP Server (format-only) running on stdio');
  }
}

const server = new ReleaseCoordinatorServer();
server.run().catch(console.error);
