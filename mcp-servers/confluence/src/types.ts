export interface ConfluenceConfig {
  baseUrl: string;
  email: string;
  apiToken: string;
}

export interface ConfluencePage {
  id: string;
  title: string;
  space: {
    key: string;
    name: string;
  };
  body?: {
    storage?: {
      value: string;
    };
  };
  version?: {
    number: number;
    when: string;
  };
  history?: {
    createdDate: string;
    createdBy?: {
      displayName: string;
    };
    lastUpdated?: {
      when: string;
    };
  };
  ancestors?: Array<{
    id: string;
    title: string;
  }>;
}

export interface ConfluenceSpace {
  key: string;
  name: string;
  type: string;
  description?: {
    plain?: {
      value: string;
    };
  };
}

export interface ConfluenceSearchResult {
  results: Array<{
    content: ConfluencePage;
  }>;
  size: number;
  totalSize: number;
}

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: {
    type: string;
    properties: Record<string, any>;
    required?: string[];
  };
}

export interface MCPToolCall {
  name: string;
  arguments: Record<string, any>;
}

export interface MCPResponse {
  content: Array<{
    type: string;
    text: string;
  }>;
}

export interface MCPToolsListResponse {
  tools: MCPTool[];
}

export interface MCPCallToolResponse {
  content: Array<{
    type: string;
    text: string;
  }>;
}

