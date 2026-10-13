import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * Host and Origin validation against DNS rebinding. Entries are exact
 * hostnames ("localhost", "budget.example.com") or suffix wildcards
 * ("*.lambda-url.us-east-1.on.aws"). A single "*" disables the check.
 */
export function hostMatcher(allowed: string[]): (hostname: string) => boolean {
  const exact = new Set(allowed.filter((entry) => !entry.startsWith('*')).map((entry) => entry.toLowerCase()));
  const suffixes = allowed.filter((entry) => entry.startsWith('*.')).map((entry) => entry.slice(1).toLowerCase());
  const any = allowed.includes('*');
  return (hostname) => {
    const name = hostname.toLowerCase();
    return any || exact.has(name) || suffixes.some((suffix) => name.endsWith(suffix) && name.length > suffix.length);
  };
}

function hostnameOf(value: string): string | null {
  try {
    return new URL(`http://${value}`).hostname.replace(/^\[|\]$/g, (match) => match);
  } catch {
    return null;
  }
}

function reject(res: ServerResponse, message: string): false {
  res.writeHead(403, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message }, id: null }));
  return false;
}

export function createHostGuard(allowed: string[]): (req: IncomingMessage, res: ServerResponse) => boolean {
  const matches = hostMatcher(allowed);
  return (req, res) => {
    const host = req.headers.host ? hostnameOf(req.headers.host) : null;
    if (!host || !matches(host)) return reject(res, `Host not allowed: ${req.headers.host ?? 'missing'}`);
    const origin = req.headers.origin;
    if (origin) {
      let originHost: string | null = null;
      try {
        originHost = new URL(origin).hostname;
      } catch {
        originHost = null;
      }
      if (!originHost || !matches(originHost)) return reject(res, `Origin not allowed: ${origin}`);
    }
    return true;
  };
}

/** The origin a client used to reach us, honouring a TLS terminating proxy in front. */
export function requestOrigin(req: IncomingMessage, fallbackPort: number): string {
  const forwardedProto = req.headers['x-forwarded-proto'];
  const proto = (Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto)?.split(',')[0]?.trim() || 'http';
  const host = req.headers['x-forwarded-host'] ?? req.headers.host ?? `localhost:${fallbackPort}`;
  return `${proto}://${Array.isArray(host) ? host[0] : host}`;
}

export function isSecureRequest(req: IncomingMessage): boolean {
  const forwardedProto = req.headers['x-forwarded-proto'];
  const proto = Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto;
  return proto?.split(',')[0]?.trim() === 'https' || Boolean((req.socket as { encrypted?: boolean }).encrypted);
}
