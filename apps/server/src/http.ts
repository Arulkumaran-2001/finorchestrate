import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export function sendJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers });
  res.end(payload);
}

export function sendError(res: ServerResponse, error: HttpError): void {
  sendJson(res, error.status, { error: error.code, message: error.message });
}

export async function readJson<T>(req: IncomingMessage, limitBytes = 256 * 1024, options: { anyContentType?: boolean } = {}): Promise<T> {
  const type = req.headers['content-type'] ?? '';
  if (!options.anyContentType && !type.toLowerCase().startsWith('application/json')) throw new HttpError(415, 'unsupported_media_type', 'Send JSON with content-type application/json.');
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limitBytes) throw new HttpError(413, 'payload_too_large', 'The request body is too large.');
    chunks.push(chunk as Buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as T;
  } catch {
    throw new HttpError(400, 'invalid_json', 'The request body is not valid JSON.');
  }
}

export function applySecurityHeaders(res: ServerResponse): void {
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('referrer-policy', 'no-referrer');
  res.setHeader('x-frame-options', 'DENY');
  res.setHeader('cross-origin-opener-policy', 'same-origin');
  res.setHeader('permissions-policy', 'camera=(), geolocation=(), microphone=(self)');
}

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

/**
 * Hashes of the inline scripts and styles of the MCP App card. The voice
 * console renders the card in a sandboxed srcdoc iframe, which inherits the
 * page's CSP, so the policy allows exactly those inline blocks and nothing else.
 */
export function inlineHashes(html: string): { scripts: string[]; styles: string[] } {
  const digest = (content: string) => `'sha256-${createHash('sha256').update(content, 'utf8').digest('base64')}'`;
  const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map((match) => match[1] ?? '').filter(Boolean).map(digest);
  const styles = [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((match) => match[1] ?? '').map(digest);
  return { scripts, styles };
}

export function contentSecurityPolicy(card: { scripts: string[]; styles: string[] }): string {
  return [
    "default-src 'self'",
    `script-src 'self' ${card.scripts.join(' ')}`.trim(),
    `style-src 'self' 'unsafe-inline'`,
    "img-src 'self' data:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "frame-src 'self' blob: data:",
    "media-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}

/** Serves the built dashboard. Hashed assets are cached for a year, HTML never. */
export async function serveStatic(req: IncomingMessage, res: ServerResponse, root: string, csp: string): Promise<boolean> {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;
  const url = new URL(req.url ?? '/', 'http://local');
  const decoded = decodeURIComponent(url.pathname);
  const target = path.resolve(root, `.${decoded}`);
  if (target !== root && !target.startsWith(root + path.sep)) return false;

  let file = target;
  const exists = await stat(file).then((info) => info.isFile(), () => false);
  if (!exists) {
    // Client side routes fall back to the app shell. Missing assets stay 404.
    if (path.extname(decoded)) return false;
    file = path.join(root, 'index.html');
  }
  const extension = path.extname(file);
  const headers: Record<string, string> = { 'content-type': CONTENT_TYPES[extension] ?? 'application/octet-stream' };
  if (extension === '.html') {
    headers['cache-control'] = 'no-cache';
    headers['content-security-policy'] = csp;
  } else {
    headers['cache-control'] = decoded.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'public, max-age=3600';
  }
  res.writeHead(200, headers);
  if (req.method === 'HEAD') {
    res.end();
    return true;
  }
  if (extension === '.html') {
    res.end(await readFile(file));
  } else {
    createReadStream(file).pipe(res);
  }
  return true;
}
