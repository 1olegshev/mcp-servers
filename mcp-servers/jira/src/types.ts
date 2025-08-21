// Jira API configuration
export interface JiraConfig {
  baseUrl: string;
  email: string;
  apiToken: string;
}

// Jira Issue structure
export interface JiraIssue {
  id: string;
  key: string;
  fields: {
    summary: string;
    description?: string;
    status: {
      name: string;
      id: string;
      statusCategory: {
        key: string;
        name: string;
      };
    };
    assignee?: {
      displayName: string;
      emailAddress: string;
      accountId: string;
    };
    reporter: {
      displayName: string;
      emailAddress: string;
      accountId: string;
    };
    priority: {
      name: string;
      id: string;
    };
    issuetype: {
      name: string;
      id: string;
    };
    labels: string[];
    components: Array<{
      id: string;
      name: string;
      description?: string;
    }>;
    created: string;
    updated: string;
    project: {
      key: string;
      name: string;
      id: string;
    };
  };
}

// Board structure  
export interface JiraBoard {
  id: number;
  name: string;
  type: string;
  location: {
    projectId: number;
    projectKey: string;
    projectName: string;
  };
}

// Search result structure
export interface JiraSearchResult {
  issues: JiraIssue[];
  total: number;
  maxResults: number;
  startAt: number;
}

// MCP Tool definitions
export interface MCPTool {
  name: string;
  description: string;
  inputSchema: {
    type: string;
    properties: Record<string, any>;
    required?: string[];
  };
}

export interface MCPResponse {
  content: Array<{
    type: string;
    text: string;
  }>;
}
