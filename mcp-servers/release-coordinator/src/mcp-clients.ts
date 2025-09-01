/**
 * MCP Clients - Functions that call other MCP servers
 * This module provides typed interfaces to call tools from other MCP servers
 */

// Re-export the MCP tool functions that are available in the global scope
// These will be injected by the MCP runtime when this server is running within an MCP environment

declare global {
  function mcp_jira_get_testing_summary(args: any): Promise<string>;
  function mcp_slack_get_auto_test_status(args: any): Promise<string>;
  function mcp_slack_get_blocking_issues(args: any): Promise<string>;
}

export async function callJiraTestingSummary(args: any = {}): Promise<string> {
  if (typeof globalThis.mcp_jira_get_testing_summary === 'function') {
    return await globalThis.mcp_jira_get_testing_summary(args);
  }
  return '⚠️ Jira MCP server not available';
}

export async function callSlackAutoTestStatus(args: any = {}): Promise<string> {
  if (typeof globalThis.mcp_slack_get_auto_test_status === 'function') {
    return await globalThis.mcp_slack_get_auto_test_status(args);
  }
  return '⚠️ Slack MCP server not available';
}

export async function callSlackBlockingIssues(args: any = {}): Promise<string> {
  if (typeof globalThis.mcp_slack_get_blocking_issues === 'function') {
    return await globalThis.mcp_slack_get_blocking_issues(args);
  }
  return '⚠️ Slack MCP server not available';
}