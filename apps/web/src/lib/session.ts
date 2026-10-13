export interface SessionInfo {
  authenticated: boolean;
  method: 'session' | 'bearer' | null;
  mode: 'key' | 'demo' | null;
  demoMode: boolean;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, { credentials: 'same-origin', ...init, headers: { 'content-type': 'application/json', ...(init.headers ?? {}) } });
  const body = (await response.json().catch(() => ({}))) as T & { message?: string };
  if (!response.ok) throw new Error(body.message ?? 'The server could not complete that request.');
  return body;
}

export const session = {
  current: () => request<SessionInfo>('/api/session'),
  signIn: (accessKey: string) => request<SessionInfo>('/api/session', { method: 'POST', body: JSON.stringify({ accessKey }) }),
  demo: () => request<SessionInfo>('/api/session/demo', { method: 'POST', body: '{}' }),
  signOut: () => request<SessionInfo>('/api/session', { method: 'DELETE' }),
};
