import { useSyncExternalStore } from 'react';

export type RouteId = 'overview' | 'assistant' | 'transactions' | 'envelopes' | 'guardian' | 'connect';

export const ROUTES: Record<RouteId, string> = {
  overview: '/',
  assistant: '/assistant',
  transactions: '/transactions',
  envelopes: '/envelopes',
  guardian: '/guardian',
  connect: '/connect',
};

const listeners = new Set<() => void>();

function notify(): void {
  listeners.forEach((listener) => listener());
}

window.addEventListener('popstate', notify);

export function navigate(path: string, options: { replace?: boolean } = {}): void {
  if (path === window.location.pathname + window.location.search) return;
  if (options.replace) window.history.replaceState(null, '', path);
  else window.history.pushState(null, '', path);
  notify();
  window.scrollTo({ top: 0 });
}

export function useLocation(): { pathname: string; search: URLSearchParams } {
  const href = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => window.location.pathname + window.location.search,
  );
  const url = new URL(href, window.location.origin);
  return { pathname: url.pathname, search: url.searchParams };
}

export function routeFor(pathname: string): RouteId {
  const entry = (Object.entries(ROUTES) as Array<[RouteId, string]>).find(([, path]) => path !== '/' && pathname.startsWith(path));
  return entry ? entry[0] : 'overview';
}
