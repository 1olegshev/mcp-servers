import axios, { AxiosInstance } from 'axios';
import { ConfluenceConfig, ConfluencePage, ConfluenceSpace, ConfluenceSearchResult } from './types.js';

export class ConfluenceClient {
  private client: AxiosInstance;

  constructor(config: ConfluenceConfig) {
    this.client = axios.create({
      baseURL: `${config.baseUrl}/wiki/rest/api`,
      auth: {
        username: config.email,
        password: config.apiToken
      },
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      }
    });
  }

  async searchContent(cql: string, limit: number = 10, expand?: string): Promise<ConfluenceSearchResult> {
    try {
      const response = await this.client.get('/content/search', {
        params: {
          cql,
          limit,
          expand: expand || 'content.space,content.history.lastUpdated,content.body.storage'
        }
      });
      return response.data;
    } catch (error: any) {
      throw new Error(`Search failed: ${error.response?.data?.message || error.message}`);
    }
  }

  async getPage(pageId: string, expand?: string): Promise<ConfluencePage> {
    try {
      const response = await this.client.get(`/content/${pageId}`, {
        params: {
          expand: expand || 'body.storage,version,space,history,history.lastUpdated,history.createdBy,ancestors'
        }
      });
      return response.data;
    } catch (error: any) {
      throw new Error(`Failed to get page: ${error.response?.data?.message || error.message}`);
    }
  }

  async getSpaces(type: string = 'global', limit: number = 50): Promise<{ results: ConfluenceSpace[] }> {
    try {
      const response = await this.client.get('/space', {
        params: {
          type,
          limit
        }
      });
      return response.data;
    } catch (error: any) {
      throw new Error(`Failed to get spaces: ${error.response?.data?.message || error.message}`);
    }
  }

  async getPagesInSpace(spaceKey: string, limit: number = 25, expand?: string): Promise<{ results: ConfluencePage[] }> {
    try {
      const response = await this.client.get('/content', {
        params: {
          spaceKey,
          limit,
          expand: expand || 'history.lastUpdated,body.storage'
        }
      });
      return response.data;
    } catch (error: any) {
      throw new Error(`Failed to get pages in space: ${error.response?.data?.message || error.message}`);
    }
  }

  async updatePage(pageId: string, title: string, content: string, version: number, status: 'current' | 'draft' = 'draft'): Promise<ConfluencePage> {
    try {
      const response = await this.client.put(`/content/${pageId}`, {
        id: pageId,
        type: 'page',
        title,
        status,
        body: {
          storage: {
            value: content,
            representation: 'storage'
          }
        },
        version: {
          number: version + 1
        }
      });
      return response.data;
    } catch (error: any) {
      throw new Error(`Failed to update page: ${error.response?.data?.message || error.message}`);
    }
  }

  async createPageDraft(spaceKey: string, title: string, content: string, parentId?: string): Promise<ConfluencePage> {
    try {
      const pageData: any = {
        type: 'page',
        title,
        status: 'draft',
        space: {
          key: spaceKey
        },
        body: {
          storage: {
            value: content,
            representation: 'storage'
          }
        }
      };

      if (parentId) {
        pageData.ancestors = [{ id: parentId }];
      }

      const response = await this.client.post('/content', pageData);
      return response.data;
    } catch (error: any) {
      throw new Error(`Failed to create draft: ${error.response?.data?.message || error.message}`);
    }
  }

  async getPageVersions(pageId: string, limit: number = 10): Promise<any> {
    try {
      const response = await this.client.get(`/content/${pageId}/version`, {
        params: { limit }
      });
      return response.data;
    } catch (error: any) {
      throw new Error(`Failed to get page versions: ${error.response?.data?.message || error.message}`);
    }
  }

  async publishDraft(pageId: string, version: number): Promise<ConfluencePage> {
    try {
      const page = await this.getPage(pageId);
      const response = await this.client.put(`/content/${pageId}`, {
        id: pageId,
        type: 'page',
        title: page.title,
        status: 'current',
        body: page.body,
        version: {
          number: version + 1
        }
      });
      return response.data;
    } catch (error: any) {
      throw new Error(`Failed to publish draft: ${error.response?.data?.message || error.message}`);
    }
  }

  async testConnection(): Promise<boolean> {
    try {
      // Try to get current user info to test auth
      await this.client.get('/user/current');
      return true;
    } catch (error: any) {
      throw new Error(`Connection test failed: ${error.response?.data?.message || error.message}`);
    }
  }
}
