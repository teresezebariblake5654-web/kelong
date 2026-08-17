import { describe, expect, it } from 'vitest';
import { mapUpstreamLlmError } from '../src/providers/llm/openaiCompatible.provider';

describe('mapUpstreamLlmError timeout mapping', () => {
  it('maps AbortError to LLM_TIMEOUT', () => {
    const err = new Error('The operation was aborted');
    err.name = 'AbortError';
    const mapped = mapUpstreamLlmError(err, 'test');
    expect(mapped.code).toBe('LLM_TIMEOUT');
    expect(mapped.statusCode).toBe(504);
  });

  it('maps auth / quota / rate-limit failures to stable codes', () => {
    expect(mapUpstreamLlmError(new Error('Incorrect API key provided'), 'test').code).toBe(
      'UPSTREAM_CREDENTIAL_INVALID',
    );
    expect(mapUpstreamLlmError(new Error('insufficient_quota'), 'test').code).toBe(
      'UPSTREAM_INSUFFICIENT_QUOTA',
    );
    expect(mapUpstreamLlmError(new Error('Rate limit exceeded 429'), 'test').code).toBe(
      'UPSTREAM_RATE_LIMITED',
    );
  });
});
