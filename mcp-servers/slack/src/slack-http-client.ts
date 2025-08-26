import fetch from 'node-fetch';

/**
 * Custom Slack client for XOXC+XOXD session-based authentication.
 * Based on patterns from the Go slackdump implementation.
 */
export class SlackXOXCClient {
  private xoxc: string;
  private xoxd?: string;
  private teamId?: string;

  constructor(xoxc: string, xoxd?: string, teamId?: string) {
    this.xoxc = xoxc;
    this.xoxd = xoxd;
    this.teamId = teamId;
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    };

    // Add session cookie if XOXD token is available
    if (this.xoxd) {
      const decodedXoxd = decodeURIComponent(this.xoxd);
      headers['Cookie'] = `d=${decodedXoxd}`;
    }

    // Add referer header for team context
    if (this.teamId) {
      headers['Referer'] = `https://app.slack.com/client/${this.teamId}`;
    }

    return headers;
  }

  async callAPI(method: string, params: Record<string, any> = {}): Promise<any> {
    const url = `https://slack.com/api/${method}`;
    const headers = this.buildHeaders();
    
    // Form-encode parameters with token
    const formParams = new URLSearchParams({
      token: this.xoxc,
      ...params
    });

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: formParams.toString()
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json() as any;
    
    if (!data.ok) {
      throw new Error(`Slack API error: ${data.error}`);
    }

    return data;
  }

  // Convenience methods for common API calls
  async authTest() {
    return this.callAPI('auth.test', {});
  }

  async conversationsHistory(params: { channel: string; limit?: number }) {
    return this.callAPI('conversations.history', params);
  }

  async chatPostMessage(params: { channel: string; text: string; thread_ts?: string }) {
    return this.callAPI('chat.postMessage', params);
  }

  async reactionsAdd(params: { channel: string; timestamp: string; name: string }) {
    return this.callAPI('reactions.add', params);
  }
}
