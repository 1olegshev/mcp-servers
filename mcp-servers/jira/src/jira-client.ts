import axios, { AxiosInstance } from 'axios';
import { JiraConfig, JiraIssue, JiraBoard, JiraSearchResult } from './types.js';

export class JiraClient {
  private client: AxiosInstance;
  private config: JiraConfig;

  constructor(config: JiraConfig) {
    this.config = config;
    
    this.client = axios.create({
      baseURL: `${config.baseUrl}/rest/api/2`,
      auth: {
        username: config.email,
        password: config.apiToken
      },
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      },
      timeout: 30000
    });
  }

  async testConnection(): Promise<boolean> {
    try {
      await this.client.get('/myself');
      return true;
    } catch (error: any) {
      throw new Error(`Connection test failed: ${error.response?.data?.message || error.message}`);
    }
  }

  async searchIssues(jql: string, maxResults: number = 50): Promise<JiraSearchResult> {
    try {
      const response = await this.client.post('/search', {
        jql,
        maxResults,
        fields: ['summary', 'status', 'assignee', 'reporter', 'priority', 'issuetype', 'labels', 'components', 'created', 'updated', 'project']
      });
      return response.data;
    } catch (error: any) {
      throw new Error(`Search failed: ${error.response?.data?.errorMessages?.join(', ') || error.message}`);
    }
  }

  async getIssue(issueKey: string): Promise<JiraIssue> {
    try {
      const response = await this.client.get(`/issue/${issueKey}`);
      return response.data;
    } catch (error: any) {
      throw new Error(`Failed to get issue: ${error.response?.data?.errorMessages?.join(', ') || error.message}`);
    }
  }

  async getBoards(): Promise<{ values: JiraBoard[] }> {
    try {
      const response = await this.client.get('/rest/agile/1.0/board', {
        baseURL: this.config.baseUrl
      });
      return response.data;
    } catch (error: any) {
      throw new Error(`Failed to get boards: ${error.response?.data?.message || error.message}`);
    }
  }

  async getBoardIssues(boardId: number, maxResults: number = 50): Promise<JiraSearchResult> {
    try {
      const response = await this.client.get(`/rest/agile/1.0/board/${boardId}/issue`, {
        baseURL: this.config.baseUrl,
        params: { maxResults }
      });
      return response.data;
    } catch (error: any) {
      throw new Error(`Failed to get board issues: ${error.response?.data?.message || error.message}`);
    }
  }

  async updateIssueLabels(issueKey: string, labels: string[]): Promise<void> {
    try {
      await this.client.put(`/issue/${issueKey}`, {
        fields: {
          labels: labels.map(label => ({ add: label }))
        }
      });
    } catch (error: any) {
      throw new Error(`Failed to update labels: ${error.response?.data?.errorMessages?.join(', ') || error.message}`);
    }
  }

  async updateIssueComponents(issueKey: string, componentIds: string[]): Promise<void> {
    try {
      await this.client.put(`/issue/${issueKey}`, {
        fields: {
          components: componentIds.map(id => ({ id }))
        }
      });
    } catch (error: any) {
      throw new Error(`Failed to update components: ${error.response?.data?.errorMessages?.join(', ') || error.message}`);
    }
  }

  async getProjectComponents(projectKey: string): Promise<Array<{ id: string; name: string; description?: string }>> {
    try {
      const response = await this.client.get(`/project/${projectKey}/components`);
      return response.data;
    } catch (error: any) {
      throw new Error(`Failed to get project components: ${error.response?.data?.errorMessages?.join(', ') || error.message}`);
    }
  }
}
