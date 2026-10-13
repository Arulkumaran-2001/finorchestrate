import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button } from '../components/Button';
import { Icon, Logo, type IconName } from '../components/Icon';
import { useToast } from '../components/overlays';
import { onLiveActivity, useQuery } from '../lib/graphql';
import { ROUTES, navigate, routeFor, useLocation, type RouteId } from '../lib/router';
import { useTheme, type ThemePreference } from '../lib/theme';
import './shell.css';

interface NavItem {
  id: RouteId;
  label: string;
  icon: IconName;
  description: string;
}

const NAV: NavItem[] = [
  { id: 'overview', label: 'Overview', icon: 'overview', description: 'Cash, runway and what needs you' },
  { id: 'assistant', label: 'Voice console', icon: 'microphone', description: 'Alexa+ simulator over MCP' },
  { id: 'transactions', label: 'Transactions', icon: 'receipt', description: 'Every charge and payment' },
  { id: 'envelopes', label: 'Envelopes', icon: 'envelope', description: 'Monthly budgets and approvals' },
  { id: 'guardian', label: 'Guardian', icon: 'shield', description: 'Autonomy policy and audit trail' },
  { id: 'connect', label: 'Connect', icon: 'plug', description: 'MCP endpoint and clients' },
];

const BADGES_QUERY = 'query Badges { overview { workspaceName periodLabel flaggedCount pendingApprovals { id } } }';

interface ShellProps {
  children: ReactNode;
  onSignOut: () => void;
  demo: boolean;
}

export function Shell({ children, onSignOut, demo }: ShellProps) {
  const { pathname } = useLocation();
  const route = routeFor(pathname);
  const [drawer, setDrawer] = useState(false);
  const toast = useToast();
  const badges = useQuery<{ overview: { workspaceName: string; periodLabel: string; flaggedCount: number; pendingApprovals: Array<{ id: string }> } }>(BADGES_QUERY);
  const counts: Partial<Record<RouteId, number>> = {
    envelopes: badges.data?.overview.pendingApprovals.length ?? 0,
    transactions: badges.data?.overview.flaggedCount ?? 0,
  };

  useEffect(() => setDrawer(false), [pathname]);

  useEffect(() => {
    if (!drawer) return;
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && setDrawer(false);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [drawer]);

  // Changes made by the voice assistant or the guardian surface as toasts on every other page.
  const routeRef = useRef(route);
  routeRef.current = route;
  useEffect(
    () =>
      onLiveActivity((events) => {
        if (routeRef.current === 'assistant') return;
        const notable = events.filter((event) => event.actor.type !== 'owner' && event.type !== 'guardian.sweep').slice(0, 2);
        for (const event of notable) {
          toast({
            title: event.title,
            detail: `${event.actor.label}. ${event.detail}`.slice(0, 180),
            tone: event.severity === 'critical' ? 'critical' : event.severity === 'warning' ? 'warning' : event.severity === 'success' ? 'success' : 'info',
          });
        }
      }),
    [toast],
  );

  const current = NAV.find((item) => item.id === route)!;

  return (
    <div className={`shell${drawer ? ' shell--drawer-open' : ''}`}>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <aside className="shell__sidebar" aria-label="Main navigation">
        <div className="shell__brand">
          <Logo size={34} />
          <div className="shell__brand-text">
            <span className="shell__brand-name">FinOrchestrate</span>
            <span className="shell__brand-tagline">Voice budget guardian</span>
          </div>
          <Button className="shell__drawer-close" variant="ghost" size="sm" icon="close" iconOnlyLabel="Close menu" onClick={() => setDrawer(false)} />
        </div>
        <nav className="shell__nav">
          {NAV.map((item) => {
            const active = item.id === route;
            const count = counts[item.id] ?? 0;
            return (
              <a
                key={item.id}
                href={ROUTES[item.id]}
                className={`nav-link${active ? ' nav-link--active' : ''}`}
                aria-current={active ? 'page' : undefined}
                data-tooltip={item.label}
                onClick={(event) => {
                  if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
                  event.preventDefault();
                  navigate(ROUTES[item.id]);
                }}
              >
                <Icon name={item.icon} size={20} />
                <span className="nav-link__text">
                  <span className="nav-link__label">{item.label}</span>
                  <span className="nav-link__description">{item.description}</span>
                </span>
                {count > 0 ? (
                  <span className="nav-link__count" aria-label={`${count} need attention`}>
                    {count}
                  </span>
                ) : null}
              </a>
            );
          })}
        </nav>
        <div className="shell__footer">
          <div className="workspace-card">
            <span className="workspace-card__avatar" aria-hidden="true">
              {(badges.data?.overview.workspaceName ?? 'L').slice(0, 1)}
            </span>
            <div className="workspace-card__text">
              <span className="workspace-card__name">{badges.data?.overview.workspaceName ?? 'Workspace'}</span>
              <span className="workspace-card__meta">{demo ? 'Demo workspace' : 'Owner access'}</span>
            </div>
          </div>
          <ThemeSwitch />
          <Button variant="ghost" icon="logout" block className="shell__signout" onClick={onSignOut}>
            Sign out
          </Button>
        </div>
      </aside>
      <button type="button" className="shell__scrim" aria-label="Close menu" tabIndex={drawer ? 0 : -1} onClick={() => setDrawer(false)} />
      <div className="shell__main">
        <header className="topbar">
          <Button className="topbar__menu" variant="ghost" icon="menu" iconOnlyLabel="Open menu" aria-expanded={drawer} onClick={() => setDrawer(true)} />
          <div className="topbar__context">
            <span className="topbar__logo">
              <Logo size={28} />
            </span>
            <span className="topbar__crumb">
              <span className="topbar__workspace">{badges.data?.overview.workspaceName ?? 'FinOrchestrate'}</span>
              <span className="topbar__sep" aria-hidden="true">
                /
              </span>
              <span className="topbar__page">{current.label}</span>
            </span>
          </div>
          <div className="topbar__actions">
            <LiveIndicator />
            {route !== 'assistant' ? (
              <Button variant="primary" icon="microphone" className="topbar__ask" onClick={() => navigate(ROUTES.assistant)}>
                Ask FinOrchestrate
              </Button>
            ) : null}
          </div>
        </header>
        <main id="main" className="shell__content" tabIndex={-1}>
          {children}
        </main>
      </div>
      {route !== 'assistant' ? (
        <button type="button" className="voice-fab" aria-label="Open the voice console" onClick={() => navigate(ROUTES.assistant)}>
          <Icon name="microphone" size={24} />
        </button>
      ) : null}
    </div>
  );
}

function LiveIndicator() {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);
  return (
    <span className={`live-indicator${online ? '' : ' live-indicator--offline'}`} title={online ? 'Live updates are on' : 'Offline'}>
      <span className="live-indicator__dot" aria-hidden="true" />
      <span className="live-indicator__text">{online ? 'Live' : 'Offline'}</span>
    </span>
  );
}

function ThemeSwitch() {
  const { preference, setPreference } = useTheme();
  const options: Array<{ value: ThemePreference; icon: IconName; label: string }> = [
    { value: 'light', icon: 'sun', label: 'Light theme' },
    { value: 'dark', icon: 'moon', label: 'Dark theme' },
    { value: 'system', icon: 'overview', label: 'Match system theme' },
  ];
  return (
    <div className="theme-switch" role="radiogroup" aria-label="Theme">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={preference === option.value}
          aria-label={option.label}
          title={option.label}
          className={`theme-switch__option${preference === option.value ? ' theme-switch__option--active' : ''}`}
          onClick={() => setPreference(option.value)}
        >
          <Icon name={option.icon} size={16} />
          <span className="theme-switch__text">{option.value === 'system' ? 'Auto' : option.value === 'light' ? 'Light' : 'Dark'}</span>
        </button>
      ))}
    </div>
  );
}
