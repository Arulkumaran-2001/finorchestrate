import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { Logo } from '../components/Icon';
import { ToastProvider } from '../components/overlays';
import { connectLiveUpdates } from '../lib/graphql';
import { routeFor, useLocation } from '../lib/router';
import { session, type SessionInfo } from '../lib/session';
import { useTheme } from '../lib/theme';
import { Shell } from './Shell';
import { SignIn } from './SignIn';
import './app.css';

const OverviewPage = lazy(() => import('../features/overview/OverviewPage'));
const AssistantPage = lazy(() => import('../features/assistant/AssistantPage'));
const TransactionsPage = lazy(() => import('../features/transactions/TransactionsPage'));
const EnvelopesPage = lazy(() => import('../features/envelopes/EnvelopesPage'));
const GuardianPage = lazy(() => import('../features/guardian/GuardianPage'));
const ConnectPage = lazy(() => import('../features/connect/ConnectPage'));

export function App() {
  useTheme();
  const [info, setInfo] = useState<SessionInfo | null>(null);
  const [failed, setFailed] = useState(false);

  const refresh = useCallback(() => {
    session
      .current()
      .then((value) => {
        setInfo(value);
        setFailed(false);
      })
      .catch(() => setFailed(true));
  }, []);

  useEffect(() => {
    refresh();
    const onUnauthorized = () => setInfo((current) => (current ? { ...current, authenticated: false } : current));
    window.addEventListener('fino:unauthorized', onUnauthorized);
    return () => window.removeEventListener('fino:unauthorized', onUnauthorized);
  }, [refresh]);

  useEffect(() => {
    if (!info?.authenticated) return;
    return connectLiveUpdates();
  }, [info?.authenticated]);

  if (failed) {
    return (
      <div className="boot">
        <Logo size={44} />
        <p className="boot__title">The FinOrchestrate server is not reachable.</p>
        <p className="boot__text">Start it with npm run dev, then try again.</p>
        <button type="button" className="boot__retry" onClick={refresh}>
          Try again
        </button>
      </div>
    );
  }
  if (!info) {
    return (
      <div className="boot" aria-busy="true">
        <Logo size={44} />
        <span className="boot__bar" />
      </div>
    );
  }
  if (!info.authenticated) return <SignIn demoAvailable={info.demoMode} onSignedIn={setInfo} />;

  return (
    <ToastProvider>
      <Shell
        demo={info.mode === 'demo'}
        onSignOut={() => {
          void session.signOut().finally(() => setInfo({ ...info, authenticated: false, mode: null, method: null }));
        }}
      >
        <Suspense fallback={<div className="route-loading" aria-busy="true" />}>
          <Routes />
        </Suspense>
      </Shell>
    </ToastProvider>
  );
}

function Routes() {
  const { pathname } = useLocation();
  switch (routeFor(pathname)) {
    case 'assistant':
      return <AssistantPage />;
    case 'transactions':
      return <TransactionsPage />;
    case 'envelopes':
      return <EnvelopesPage />;
    case 'guardian':
      return <GuardianPage />;
    case 'connect':
      return <ConnectPage />;
    default:
      return <OverviewPage />;
  }
}
