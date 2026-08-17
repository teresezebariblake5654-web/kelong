import { describe, expect, it } from 'vitest';
import {
  looksLikeWorkhorseSystemEnvelope,
  normalizeWorkhorseVisibleUserText,
} from './workhorseOutboundPrompt';

describe('normalizeWorkhorseVisibleUserText', () => {
  it('keeps only the current user request', () => {
    const raw = `[Workhorse AI system instructions]
hidden setup

[Current user request]
rewrite the intro`;
    expect(normalizeWorkhorseVisibleUserText(raw)).toBe('rewrite the intro');
    expect(looksLikeWorkhorseSystemEnvelope(raw)).toBe(true);
  });

  it('leaves plain user text unchanged', () => {
    expect(normalizeWorkhorseVisibleUserText('你好')).toBe('你好');
    expect(looksLikeWorkhorseSystemEnvelope('你好')).toBe(false);
  });
});
