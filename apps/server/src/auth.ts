import { createHmac, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { AuthInfo } from '@modelcontextprotocol/server';

export const SESSION_COOKIE = 'fino_session';
const SESSION_TTL_SECONDS = 12 * 60 * 60;

export type SessionMode = 'key' | 'demo';

interface SessionPayload {
  sub: 'owner';
  mode: SessionMode;
  iat: number;
  exp: number;
}

export interface Principal {
  /** Stable id used for briefing memory and the audit trail. */
  clientId: string;
  /** How the caller proved itself. */
  method: 'session' | 'bearer';
  mode?: SessionMode;
}

export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function signSession(secret: string, mode: SessionMode, now = Date.now()): { value: string; maxAge: number } {
  const payload: SessionPayload = { sub: 'owner', mode, iat: Math.floor(now / 1000), exp: Math.floor(now / 1000) + SESSION_TTL_SECONDS };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = createHmac('sha256', secret).update(body).digest('base64url');
  return { value: `${body}.${signature}`, maxAge: SESSION_TTL_SECONDS };
}

export function verifySession(secret: string, value: string | undefined, now = Date.now()): SessionPayload | null {
  if (!value) return null;
  const [body, signature] = value.split('.');
  if (!body || !signature) return null;
  const expected = createHmac('sha256', secret).update(body).digest('base64url');
  if (!safeEqual(signature, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as SessionPayload;
    if (payload.sub !== 'owner' || typeof payload.exp !== 'number' || payload.exp * 1000 <= now) return null;
    return payload;
  } catch {
    return null;
  }
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!header) return cookies;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (name) cookies[name] = decodeURIComponent(value);
  }
  return cookies;
}

export function sessionCookie(value: string, maxAge: number, secure: boolean): string {
  return `${SESSION_COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}

export function clearedSessionCookie(secure: boolean): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure ? '; Secure' : ''}`;
}

export function bearerToken(req: IncomingMessage): string | null {
  const header = req.headers.authorization;
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match ? match[1]!.trim() : null;
}

/**
 * Accepts either a signed dashboard session or the API bearer token. MCP
 * clients such as an Alexa+ connector use the token; the dashboard and its
 * built in voice console use the session cookie.
 */
export function authenticate(req: IncomingMessage, options: { apiToken: string; sessionSecret: string }): Principal | null {
  const token = bearerToken(req);
  if (token) return safeEqual(token, options.apiToken) ? { clientId: 'api-token', method: 'bearer' } : null;
  const session = verifySession(options.sessionSecret, parseCookies(req.headers.cookie)[SESSION_COOKIE]);
  if (!session) return null;
  return { clientId: 'web-console', method: 'session', mode: session.mode };
}

export function toAuthInfo(principal: Principal, token: string): AuthInfo {
  return {
    token: principal.method === 'bearer' ? token : 'session',
    clientId: principal.clientId,
    scopes: ['ledger:read', 'ledger:write'],
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
  };
}

/** Fixed window limiter keyed by client address. Enough to blunt key guessing. */
export class RateLimiter {
  private readonly hits = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  allow(key: string, now = Date.now()): boolean {
    const entry = this.hits.get(key);
    if (!entry || entry.resetAt <= now) {
      this.hits.set(key, { count: 1, resetAt: now + this.windowMs });
      if (this.hits.size > 5000) this.prune(now);
      return true;
    }
    entry.count += 1;
    return entry.count <= this.limit;
  }

  private prune(now: number): void {
    for (const [key, entry] of this.hits) if (entry.resetAt <= now) this.hits.delete(key);
  }
}

export function clientAddress(req: IncomingMessage): string {
  const forwarded = req.headers['x-forwarded-for'];
  const first = Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(',')[0];
  return first?.trim() || req.socket.remoteAddress || 'unknown';
}
