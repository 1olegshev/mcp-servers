/**
 * Shared Ollama LLM Client
 * Used by both test classifier and blocker classifier services
 */

export interface OllamaGenerateOptions {
  temperature?: number;
  num_predict?: number;
  timeout?: number;
  /** JSON schema for structured output - ensures valid JSON response */
  format?: Record<string, unknown>;
}

export interface OllamaResponse {
  model: string;
  created_at: string;
  response: string;
  thinking?: string;
  done: boolean;
}

export class OllamaClient {
  private baseUrl: string;
  private model: string;
  private availabilityChecked: boolean = false;
  private isAvailableCache: boolean = false;

  constructor(
    baseUrl: string = 'http://localhost:11434',
    model: string = 'qwen3:30b-a3b-instruct-2507-q4_K_M'
  ) {
    this.baseUrl = baseUrl;
    this.model = model;
  }

  /**
   * Check if Ollama is available and the model is loaded
   */
  async isAvailable(): Promise<boolean> {
    if (this.availabilityChecked) {
      return this.isAvailableCache;
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(`${this.baseUrl}/api/tags`, {
        signal: controller.signal
      });
      clearTimeout(timeout);

      if (!response.ok) {
        this.isAvailableCache = false;
        this.availabilityChecked = true;
        return false;
      }

      const data = await response.json();
      const models = data.models || [];
      this.isAvailableCache = models.some((m: any) =>
        m.name === this.model || m.name.startsWith(this.model.split(':')[0])
      );
      this.availabilityChecked = true;
      return this.isAvailableCache;
    } catch {
      this.isAvailableCache = false;
      this.availabilityChecked = true;
      return false;
    }
  }

  /**
   * Reset availability cache (useful if Ollama was started after initial check)
   */
  resetAvailabilityCache(): void {
    this.availabilityChecked = false;
    this.isAvailableCache = false;
  }

  /**
   * Generate a response from the model
   */
  async generate(prompt: string, options: OllamaGenerateOptions = {}): Promise<string> {
    const {
      temperature = 0.3,
      num_predict = 512,
      timeout = 30000,
      format
    } = options;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    const startTime = Date.now();

    try {
      const requestBody: Record<string, unknown> = {
        model: this.model,
        prompt,
        stream: false,
        options: {
          temperature,
          num_predict
        }
      };

      // Add structured output format if provided
      if (format) {
        requestBody.format = format;
      }

      const response = await fetch(`${this.baseUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Ollama API error: ${response.status}`);
      }

      const data = await response.json() as OllamaResponse;
      const duration = Date.now() - startTime;
      console.error(`[Ollama] generate completed in ${duration}ms (prompt: ${prompt.length} chars)`);

      // Qwen3 puts thinking in separate field, actual output in response
      if (data.response && data.response.trim()) {
        return data.response;
      }
      return data.thinking || '';
    } catch (error) {
      const duration = Date.now() - startTime;
      console.error(`[Ollama] generate failed after ${duration}ms: ${error}`);
      clearTimeout(timeoutId);
      throw error;
    }
  }

  /**
   * Clean response text - removes thinking tokens and extracts content
   */
  static cleanResponse(response: string): string {
    let clean = response;

    // Remove <think>...</think> blocks
    clean = clean.replace(/<think>[\s\S]*?<\/think>/gi, '');

    // Handle unclosed <think> tags - take everything after it
    const thinkStart = clean.indexOf('<think>');
    if (thinkStart !== -1) {
      clean = clean.substring(thinkStart + 7);
    }

    // Trim and remove markdown code block markers
    clean = clean.trim();
    clean = clean.replace(/^```json?\s*/i, '').replace(/\s*```$/i, '');

    return clean;
  }

  /**
   * Extract balanced JSON from text - handles nested braces/brackets correctly
   * Supports both objects {...} and arrays [...]
   */
  static extractBalancedJSON(text: string): string | null {
    // Find first [ or { to determine if it's an array or object
    const objStart = text.indexOf('{');
    const arrStart = text.indexOf('[');

    // Pick whichever comes first (or exists)
    let start: number;
    let openChar: string;
    let closeChar: string;

    if (arrStart !== -1 && (objStart === -1 || arrStart < objStart)) {
      start = arrStart;
      openChar = '[';
      closeChar = ']';
    } else if (objStart !== -1) {
      start = objStart;
      openChar = '{';
      closeChar = '}';
    } else {
      return null;
    }

    let depth = 0;
    let inString = false;
    let escape = false;

    for (let i = start; i < text.length; i++) {
      const char = text[i];

      if (escape) {
        escape = false;
        continue;
      }

      if (char === '\\' && inString) {
        escape = true;
        continue;
      }

      if (char === '"') {
        inString = !inString;
        continue;
      }

      if (inString) continue;

      if (char === openChar || char === '{' || char === '[') depth++;
      else if (char === closeChar || char === '}' || char === ']') {
        depth--;
        if (depth === 0) {
          return text.substring(start, i + 1);
        }
      }
    }

    return null;
  }

  /**
   * Get the model name
   */
  getModel(): string {
    return this.model;
  }

  /**
   * Get the base URL
   */
  getBaseUrl(): string {
    return this.baseUrl;
  }
}
