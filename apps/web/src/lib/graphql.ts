import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';

export class GraphQLRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
  }
}

export async function gql<T>(query: string, variables: Record<string, unknown> = {}, signal?: AbortSignal): Promise<T> {
  const response = await fetch('/graphql', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/graphql-response+json, application/json' },
    body: JSON.stringify({ query, variables }),
    credentials: 'same-origin',
    signal,
  });
  if (response.status === 401) {
    window.dispatchEvent(new CustomEvent('fino:unauthorized'));
    throw new GraphQLRequestError('Your session has ended. Sign in again.', 401);
  }
  const body = (await response.json().catch(() => ({}))) as { data?: T; errors?: Array<{ message: string; extensions?: { code?: string } }> };
  if (body.errors?.length) {
    const first = body.errors[0]!;
    throw new GraphQLRequestError(first.message, response.status, first.extensions?.code);
  }
  if (!response.ok || !body.data) throw new GraphQLRequestError('The server could not answer right now.', response.status);
  return body.data;
}

/* ---------------------------------------------------------------- live */

type Listener = () => void;
let ledgerVersion = 0;
const versionListeners = new Set<Listener>();

export interface LiveActivity {
  id: string;
  at: string;
  type: string;
  severity: 'info' | 'success' | 'warning' | 'critical';
  title: string;
  detail: string;
  actor: { type: string; label: string };
}

const activityListeners = new Set<(events: LiveActivity[]) => void>();

export function bumpLedgerVersion(): void {
  ledgerVersion += 1;
  versionListeners.forEach((listener) => listener());
}

export function useLedgerVersion(): number {
  return useSyncExternalStore(
    (listener) => {
      versionListeners.add(listener);
      return () => versionListeners.delete(listener);
    },
    () => ledgerVersion,
  );
}

export function onLiveActivity(listener: (events: LiveActivity[]) => void): () => void {
  activityListeners.add(listener);
  return () => activityListeners.delete(listener);
}

const SUBSCRIPTION = 'subscription { ledgerEvents { at activity { id at type severity title detail actor { type label } } } }';

/**
 * GraphQL subscription over server sent events. Any change to the ledger,
 * from the dashboard, a voice command or the scheduled guardian, refreshes
 * every visible query.
 */
export function connectLiveUpdates(): () => void {
  let source: EventSource | null = null;
  let retry: number | undefined;
  let attempts = 0;
  const open = () => {
    source = new EventSource(`/graphql?query=${encodeURIComponent(SUBSCRIPTION)}`, { withCredentials: true });
    source.addEventListener('next', (event) => handle((event as MessageEvent).data));
    source.onmessage = (event) => handle(event.data);
    source.onopen = () => {
      attempts = 0;
    };
    source.onerror = () => {
      source?.close();
      attempts += 1;
      retry = window.setTimeout(open, Math.min(30_000, 1000 * 2 ** attempts));
    };
  };
  const handle = (raw: string) => {
    try {
      const payload = JSON.parse(raw) as { data?: { ledgerEvents?: { activity: LiveActivity[] } } };
      const activity = payload.data?.ledgerEvents?.activity;
      if (!activity) return;
      bumpLedgerVersion();
      activityListeners.forEach((listener) => listener(activity));
    } catch {
      // Keep-alive comments and malformed frames are ignored.
    }
  };
  open();
  return () => {
    window.clearTimeout(retry);
    source?.close();
  };
}

/* ---------------------------------------------------------------- hooks */

export interface QueryState<T> {
  data: T | undefined;
  error: Error | undefined;
  loading: boolean;
  refetch: () => void;
}

/** Runs a query, keeps the previous data while refreshing, and refetches on every ledger change. */
export function useQuery<T>(query: string, variables: Record<string, unknown> = {}): QueryState<T> {
  const version = useLedgerVersion();
  const key = JSON.stringify(variables);
  const [state, setState] = useState<{ data?: T; error?: Error; loading: boolean }>({ loading: true });
  const [nonce, setNonce] = useState(0);
  const refetch = useCallback(() => setNonce((value) => value + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    setState((previous) => ({ ...previous, loading: true }));
    gql<T>(query, JSON.parse(key) as Record<string, unknown>, controller.signal)
      .then((data) => setState({ data, loading: false }))
      .catch((error: Error) => {
        if (controller.signal.aborted) return;
        setState((previous) => ({ data: previous.data, error, loading: false }));
      });
    return () => controller.abort();
  }, [query, key, version, nonce]);

  return { data: state.data, error: state.error, loading: state.loading, refetch };
}

export function useMutation<T, V extends Record<string, unknown> = Record<string, unknown>>(mutation: string) {
  const [pending, setPending] = useState(false);
  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );
  const run = useCallback(
    async (variables?: V): Promise<T> => {
      setPending(true);
      try {
        const data = await gql<T>(mutation, variables ?? {});
        bumpLedgerVersion();
        return data;
      } finally {
        if (mounted.current) setPending(false);
      }
    },
    [mutation],
  );
  return { run, pending };
}
