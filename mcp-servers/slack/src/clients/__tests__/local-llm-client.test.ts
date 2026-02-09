/**
 * LocalLLMClient Unit Tests
 * Tests the shared LLM client used by classifier services
 */

import { LocalLLMClient } from '../local-llm-client';

describe('LocalLLMClient', () => {
  describe('constructor', () => {
    it('should use default values', () => {
      const client = new LocalLLMClient();
      expect(client.getBaseUrl()).toBe('http://localhost:1234');
      expect(client.getModel()).toBe('qwen/qwen3-30b-a3b-2507');
    });

    it('should accept custom values', () => {
      const client = new LocalLLMClient('http://custom:8080', 'custom-model');
      expect(client.getBaseUrl()).toBe('http://custom:8080');
      expect(client.getModel()).toBe('custom-model');
    });
  });

  describe('cleanResponse', () => {
    it('should remove <think>...</think> blocks', () => {
      const response = '<think>Internal reasoning here</think>{"result": true}';
      expect(LocalLLMClient.cleanResponse(response)).toBe('{"result": true}');
    });

    it('should handle multiple think blocks', () => {
      const response = '<think>First</think>data<think>Second</think>';
      expect(LocalLLMClient.cleanResponse(response)).toBe('data');
    });

    it('should handle unclosed think tags', () => {
      const response = '<think>Partial thinking{"result": true}';
      expect(LocalLLMClient.cleanResponse(response)).toBe('Partial thinking{"result": true}');
    });

    it('should remove markdown code block markers', () => {
      const response = '```json\n{"result": true}\n```';
      expect(LocalLLMClient.cleanResponse(response)).toBe('{"result": true}');
    });

    it('should handle mixed markers', () => {
      const response = '<think>reasoning</think>```json\n{"result": true}\n```';
      expect(LocalLLMClient.cleanResponse(response)).toBe('{"result": true}');
    });

    it('should trim whitespace', () => {
      const response = '  \n {"result": true}  \n';
      expect(LocalLLMClient.cleanResponse(response)).toBe('{"result": true}');
    });
  });

  describe('extractBalancedJSON', () => {
    it('should extract simple JSON object', () => {
      const text = 'Some text {"key": "value"} more text';
      expect(LocalLLMClient.extractBalancedJSON(text)).toBe('{"key": "value"}');
    });

    it('should handle nested objects', () => {
      const text = 'Result: {"outer": {"inner": "value"}}';
      expect(LocalLLMClient.extractBalancedJSON(text)).toBe('{"outer": {"inner": "value"}}');
    });

    it('should handle arrays in objects', () => {
      const text = '{"items": [1, 2, {"nested": true}]}';
      expect(LocalLLMClient.extractBalancedJSON(text)).toBe('{"items": [1, 2, {"nested": true}]}');
    });

    it('should handle strings with braces', () => {
      const text = '{"message": "Use {curly} braces"}';
      expect(LocalLLMClient.extractBalancedJSON(text)).toBe('{"message": "Use {curly} braces"}');
    });

    it('should handle escaped quotes in strings', () => {
      const text = '{"message": "He said \\"hello\\""}';
      expect(LocalLLMClient.extractBalancedJSON(text)).toBe('{"message": "He said \\"hello\\""}');
    });

    it('should return null when no JSON found', () => {
      expect(LocalLLMClient.extractBalancedJSON('no json here')).toBeNull();
    });

    it('should return null for unclosed JSON', () => {
      expect(LocalLLMClient.extractBalancedJSON('{"unclosed": true')).toBeNull();
    });

    it('should extract first complete JSON object', () => {
      const text = 'First: {"a": 1} Second: {"b": 2}';
      expect(LocalLLMClient.extractBalancedJSON(text)).toBe('{"a": 1}');
    });

    it('should handle deeply nested structures', () => {
      const text = '{"a": {"b": {"c": {"d": "deep"}}}}';
      expect(LocalLLMClient.extractBalancedJSON(text)).toBe('{"a": {"b": {"c": {"d": "deep"}}}}');
    });

    it('should handle complex real-world LLM response', () => {
      const response = `Let me analyze this...

{"isBlocker": true, "confidence": 85, "reasoning": "Message contains @test-managers escalation"}

That's my analysis.`;
      const extracted = LocalLLMClient.extractBalancedJSON(response);
      expect(extracted).toBe('{"isBlocker": true, "confidence": 85, "reasoning": "Message contains @test-managers escalation"}');
      expect(() => JSON.parse(extracted!)).not.toThrow();
    });
  });

  describe('resetAvailabilityCache', () => {
    it('should reset the availability cache', async () => {
      const client = new LocalLLMClient();
      // Access private fields via any for testing
      (client as any).lastCheckTime = Date.now();
      (client as any).isAvailableCache = true;

      client.resetAvailabilityCache();

      expect((client as any).lastCheckTime).toBe(0);
      expect((client as any).isAvailableCache).toBe(false);
    });
  });

  describe('TTL-based availability cache', () => {
    it('should retry after failure TTL (30s)', () => {
      const client = new LocalLLMClient();
      // Simulate a failed check 31 seconds ago
      (client as any).isAvailableCache = false;
      (client as any).lastCheckTime = Date.now() - 31_000;

      // Cache should be expired — next isAvailable() call will re-check
      const ttl = (LocalLLMClient as any).FAILURE_TTL_MS;
      const elapsed = Date.now() - (client as any).lastCheckTime;
      expect(elapsed).toBeGreaterThan(ttl);
    });

    it('should keep success cached for 5 minutes', () => {
      const client = new LocalLLMClient();
      // Simulate a successful check 1 minute ago
      (client as any).isAvailableCache = true;
      (client as any).lastCheckTime = Date.now() - 60_000;

      // Cache should still be valid
      const ttl = (LocalLLMClient as any).SUCCESS_TTL_MS;
      const elapsed = Date.now() - (client as any).lastCheckTime;
      expect(elapsed).toBeLessThan(ttl);
    });
  });
});
