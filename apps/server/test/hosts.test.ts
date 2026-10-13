import { describe, expect, it } from 'vitest';
import { hostMatcher } from '../src/hosts.js';
import { signSession, verifySession } from '../src/auth.js';

describe('host matching', () => {
  const matches = hostMatcher(['localhost', '127.0.0.1', '*.lambda-url.us-east-1.on.aws']);

  it('accepts exact and wildcard hosts', () => {
    expect(matches('localhost')).toBe(true);
    expect(matches('abc123.lambda-url.us-east-1.on.aws')).toBe(true);
  });

  it('rejects look alikes and the bare suffix', () => {
    expect(matches('lambda-url.us-east-1.on.aws')).toBe(false);
    expect(matches('evil-lambda-url.us-east-1.on.aws.example.com')).toBe(false);
    expect(matches('localhost.example.com')).toBe(false);
  });

  it('allows everything only when asked to', () => {
    expect(hostMatcher(['*'])('anything.example')).toBe(true);
  });
});

describe('session cookies', () => {
  it('round trips and expires', () => {
    const now = Date.parse('2026-10-13T08:00:00Z');
    const { value } = signSession('secret', 'demo', now);
    expect(verifySession('secret', value, now)?.mode).toBe('demo');
    expect(verifySession('other-secret', value, now)).toBeNull();
    expect(verifySession('secret', value, now + 13 * 3_600_000)).toBeNull();
    expect(verifySession('secret', `${value}x`, now)).toBeNull();
  });
});
