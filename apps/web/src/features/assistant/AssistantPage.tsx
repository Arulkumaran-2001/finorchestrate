import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type FormEvent, type KeyboardEvent } from 'react';
import { EXAMPLE_UTTERANCES, WAKE_PHRASE, type IntentContext } from '@finorchestrate/core';
import { Button } from '../../components/Button';
import { Icon } from '../../components/Icon';
import { Segmented, Toggle } from '../../components/forms';
import { Badge } from '../../components/Status';
import { CATEGORIES_QUERY, type CategoryDefinition } from '../../lib/api';
import { useQuery } from '../../lib/graphql';
import { useTheme } from '../../lib/theme';
import { McpHost, type TraceEntry } from '../../mcp/host';
import { McpAppFrame } from '../../mcp/McpAppFrame';
import { runBedrock, runLocal, type BedrockMessage, type ToolCallRecord } from '../../mcp/planner';
import { listen, speak, speechSupport, stopSpeaking } from '../../mcp/speech';
import { WakeListener } from '../../mcp/wake';
import './assistant.css';

interface Turn {
  id: string;
  role: 'user' | 'assistant' | 'note';
  text: string;
  pending?: boolean;
  calls?: ToolCallRecord[];
  planner?: 'local' | 'bedrock';
  understood?: string | null;
  fallback?: string | null;
}

type OrbState = 'idle' | 'listening' | 'thinking' | 'speaking';
type OrbLook = OrbState | 'armed';

let turnCounter = 0;
const nextId = () => `turn-${(turnCounter += 1)}`;

function useHost(): McpHost {
  const host = useMemo(() => new McpHost(), []);
  useSyncExternalStore(
    (listener) => host.subscribe(listener),
    () => `${host.status}:${host.traces.length}:${host.traces[0]?.status ?? ''}:${host.traces[0]?.durationMs ?? ''}`,
  );
  useEffect(() => {
    host.retain();
    return () => host.release();
  }, [host]);
  return host;
}

function useWake(): WakeListener {
  const wake = useMemo(() => new WakeListener(), []);
  useSyncExternalStore(
    (listener) => wake.subscribe(listener),
    () => wake.snapshot(),
  );
  useEffect(() => () => wake.destroy(), [wake]);
  return wake;
}

function readSpeakPreference(): boolean {
  try {
    return window.localStorage.getItem('finorchestrate.speak') !== 'off';
  } catch {
    return true;
  }
}

export default function AssistantPage() {
  const host = useHost();
  const wake = useWake();
  const { resolved: theme } = useTheme();
  const categories = useQuery<{ categories: CategoryDefinition[] }>(CATEGORIES_QUERY);
  const [planner, setPlanner] = useState<{ kind: string; model: string | null }>({ kind: 'local', model: null });
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState('');
  const [interim, setInterim] = useState('');
  const [orb, setOrb] = useState<OrbState>('idle');
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [speakReplies, setSpeakReplies] = useState(readSpeakPreference);
  const [panel, setPanel] = useState<'conversation' | 'protocol'>('conversation');
  const [inspectorTab, setInspectorTab] = useState<'trace' | 'tools'>('trace');
  const history = useRef<BedrockMessage[]>([]);
  const stopListening = useRef<(() => void) | null>(null);
  const log = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch('/api/agent/status', { credentials: 'same-origin' })
      .then((response) => (response.ok ? response.json() : null))
      .then((value) => value && setPlanner(value))
      .catch(() => undefined);
    return () => {
      stopSpeaking();
      stopListening.current?.();
    };
  }, []);

  // Follow the conversation as turns arrive and as cards grow, unless the reader scrolled up.
  const follow = useRef(true);
  useEffect(() => {
    const element = log.current;
    if (!element) return;
    const onScroll = () => {
      follow.current = element.scrollHeight - element.scrollTop - element.clientHeight < 120;
    };
    const observer = new ResizeObserver(() => {
      if (follow.current) element.scrollTo({ top: element.scrollHeight, behavior: 'smooth' });
    });
    element.addEventListener('scroll', onScroll, { passive: true });
    for (const child of Array.from(element.children)) observer.observe(child);
    const mutation = new MutationObserver(() => {
      for (const child of Array.from(element.children)) observer.observe(child);
    });
    mutation.observe(element, { childList: true });
    return () => {
      element.removeEventListener('scroll', onScroll);
      observer.disconnect();
      mutation.disconnect();
    };
  }, []);

  useEffect(() => {
    follow.current = true;
    log.current?.scrollTo({ top: log.current.scrollHeight, behavior: 'smooth' });
  }, [turns.length]);

  // The server owns envelope names and their spoken keywords, so the intent engine always matches the live ledger.
  const intentContext: IntentContext = useMemo(
    () => ({
      categories: (categories.data?.categories ?? []).map((entry) => ({
        id: entry.id,
        name: entry.name,
        kind: entry.kind as 'operating' | 'reserve',
        keywords: entry.keywords ?? [],
      })),
    }),
    [categories.data],
  );

  const ask = useCallback(
    async (raw: string) => {
      const text = raw.trim();
      if (!text || orb === 'thinking') return;
      stopSpeaking();
      setDraft('');
      setInterim('');
      setVoiceError(null);
      const userTurn: Turn = { id: nextId(), role: 'user', text };
      const pendingTurn: Turn = { id: nextId(), role: 'assistant', text: '', pending: true };
      setTurns((current) => [...current, userTurn, pendingTurn]);
      setOrb('thinking');
      if (host.status !== 'ready') await host.connect();
      let outcome;
      if (planner.kind === 'bedrock') {
        const response = await runBedrock(host, text, history.current, intentContext);
        history.current = response.history;
        outcome = response.outcome;
      } else {
        outcome = await runLocal(host, text, intentContext);
      }
      setTurns((current) =>
        current.map((turn) =>
          turn.id === pendingTurn.id
            ? { ...turn, pending: false, text: outcome.reply, calls: outcome.calls, planner: outcome.planner, understood: outcome.understood, fallback: outcome.fallback }
            : turn,
        ),
      );
      if (speakReplies && speechSupport.synthesis()) {
        setOrb('speaking');
        speak(outcome.reply, () => setOrb((state) => (state === 'speaking' ? 'idle' : state)));
      } else {
        setOrb('idle');
      }
    },
    [host, intentContext, orb, planner.kind, speakReplies],
  );

  // Hands-free hears only while the console is idle, so it never transcribes its own replies.
  const orbRef = useRef(orb);
  useEffect(() => {
    orbRef.current = orb;
    if (orb === 'idle') wake.release();
    else wake.hold();
  }, [orb, wake]);

  useEffect(() => {
    wake.onCommand = (text) => {
      void ask(text).finally(() => {
        if (orbRef.current === 'idle') wake.release();
      });
    };
  }, [wake, ask]);

  const setHandsFree = (value: boolean) => {
    setVoiceError(null);
    if (value) void wake.enable();
    else wake.disable();
  };

  const toggleListening = () => {
    if (orb === 'listening') {
      stopListening.current?.();
      return;
    }
    if (orb === 'thinking') return;
    wake.hold();
    stopSpeaking();
    setVoiceError(null);
    setInterim('');
    setOrb('listening');
    stopListening.current = listen({
      onInterim: setInterim,
      onFinal: (text) => void ask(text),
      onEnd: () => {
        stopListening.current = null;
        setOrb((state) => (state === 'listening' ? 'idle' : state));
      },
      onError: (message) => setVoiceError(message),
    });
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void ask(draft);
  };

  const onInputKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowUp' && !draft) {
      const last = [...turns].reverse().find((turn) => turn.role === 'user');
      if (last) {
        event.preventDefault();
        setDraft(last.text);
      }
    }
  };

  const setSpeak = (value: boolean) => {
    setSpeakReplies(value);
    if (!value) stopSpeaking();
    try {
      window.localStorage.setItem('finorchestrate.speak', value ? 'on' : 'off');
    } catch {
      // Preference is kept for this visit only.
    }
  };

  const addNote = useCallback((text: string) => {
    setTurns((current) => [...current, { id: nextId(), role: 'note', text }]);
  }, []);

  const connected = host.status === 'ready';
  const awake = orb === 'idle' && wake.status === 'awake';
  const look: OrbLook = awake ? 'listening' : orb === 'idle' && wake.status === 'waiting' ? 'armed' : orb;
  const orbLabel = {
    idle: 'Tap to talk',
    armed: `Say "${WAKE_PHRASE}"`,
    listening: 'Listening',
    thinking: 'Working on it',
    speaking: 'Speaking',
  }[look];
  const placeholder =
    look === 'listening'
      ? 'Listening...'
      : look === 'armed'
        ? `Say "${WAKE_PHRASE}", then ask`
        : wake.status === 'preparing'
          ? 'Getting hands-free ready...'
          : 'Ask about budgets, runway, charges or approvals';
  const heard = orb === 'listening' ? interim : awake ? wake.heard : '';
  const voiceMessage = voiceError ?? wake.message;
  const handsFreeNote =
    wake.status === 'off' || wake.status === 'error'
      ? `Wake the console by saying "${WAKE_PHRASE}"`
      : wake.status === 'preparing'
        ? 'Checking for on-device speech'
        : wake.engine === 'device'
          ? 'Speech is recognized on this device'
          : "Audio goes to the browser's speech service while on";

  return (
    <div className={`console console--${panel}`}>
      <div className="console__switch">
        <Segmented<'conversation' | 'protocol'>
          label="Console view"
          stretch
          value={panel}
          onChange={setPanel}
          options={[
            { value: 'conversation', label: 'Conversation', icon: 'microphone' },
            { value: 'protocol', label: 'Protocol', icon: 'terminal' },
          ]}
        />
      </div>

      <section className="console__stage" aria-label="Conversation">
        <header className="console__header">
          <div className="console__heading">
            <h1 className="console__title">Voice console</h1>
            <p className="console__subtitle">An Alexa+ style host. It speaks MCP to FinOrchestrate, renders its MCP App cards and reads the answers aloud.</p>
          </div>
          <div className="console__badges">
            <Badge tone={connected ? 'good' : host.status === 'error' ? 'critical' : 'neutral'}>
              <Icon name={connected ? 'success' : host.status === 'error' ? 'critical' : 'clock'} size={13} />
              {connected ? `MCP ${host.info?.protocolVersion ?? ''}` : host.status === 'error' ? 'MCP offline' : 'Connecting'}
            </Badge>
            {wake.enabled && wake.engine ? (
              <Badge tone={wake.engine === 'device' ? 'good' : 'neutral'}>
                <Icon name={wake.engine === 'device' ? 'lock' : 'cloud'} size={13} />
                {wake.engine === 'device' ? 'Hands-free, on device' : 'Hands-free, speech service'}
              </Badge>
            ) : null}
            <Badge tone="accent">
              <Icon name={planner.kind === 'bedrock' ? 'cloud' : 'code'} size={13} />
              {planner.kind === 'bedrock' ? `Bedrock ${planner.model ?? ''}`.trim() : 'Local intent engine'}
            </Badge>
          </div>
        </header>

        <div ref={log} className="console__log" role="log" aria-live="polite" aria-label="Conversation transcript">
          {turns.length === 0 ? (
            <div className="console__welcome">
              <p className="console__welcome-title">Ask about money the way you would ask a teammate.</p>
              <p className="console__welcome-text">Every answer comes from a real MCP tool call, so the cards below are what Alexa+ or any MCP Apps host would show.</p>
              <ul className="console__examples">
                {EXAMPLE_UTTERANCES.map((example) => (
                  <li key={example}>
                    <button type="button" className="example-chip" onClick={() => void ask(example)} disabled={!connected}>
                      <Icon name="microphone" size={14} />
                      {example}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            turns.map((turn) => <TurnView key={turn.id} turn={turn} host={host} theme={theme} onNote={addNote} />)
          )}
        </div>

        <form className="composer" onSubmit={submit}>
          {turns.length > 0 ? (
            <div className="composer__chips" aria-label="Suggestions">
              {EXAMPLE_UTTERANCES.map((example) => (
                <button key={example} type="button" className="example-chip example-chip--small" onClick={() => void ask(example)} disabled={orb === 'thinking'}>
                  {example}
                </button>
              ))}
            </div>
          ) : null}
          {voiceMessage ? (
            <p className="composer__error" role="alert">
              <Icon name="warning" size={14} />
              {voiceMessage}
            </p>
          ) : null}
          <div className="composer__bar">
            <button
              type="button"
              className={`orb orb--${look}`}
              onClick={toggleListening}
              aria-pressed={orb === 'listening'}
              aria-label={orb === 'listening' ? 'Stop listening' : 'Start voice input'}
              disabled={!connected || orb === 'thinking'}
              title={speechSupport.recognition() ? orbLabel : 'Voice input needs Chrome or Edge'}
            >
              <span className="orb__ring" aria-hidden="true" />
              <span className="orb__core">
                <Icon name={orb === 'listening' ? 'stop' : look === 'speaking' ? 'speaker' : 'microphone'} size={22} />
              </span>
            </button>
            <div className="composer__field">
              <label htmlFor="console-input" className="visually-hidden">
                Ask FinOrchestrate
              </label>
              <input
                ref={input}
                id="console-input"
                className="composer__input"
                placeholder={placeholder}
                value={heard || draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={onInputKey}
                autoComplete="off"
                maxLength={300}
                readOnly={orb === 'listening' || awake}
              />
              <span className="composer__state" aria-live="polite">
                {orbLabel}
              </span>
            </div>
            <Button type="submit" variant="primary" icon="send" iconOnlyLabel="Send" disabled={!draft.trim() || !connected || orb === 'thinking'} />
          </div>
          <div className="composer__options">
            <div className="composer__toggles">
              <Toggle
                checked={wake.enabled}
                onChange={setHandsFree}
                label="Hands-free"
                description={handsFreeNote}
                disabled={!connected || !speechSupport.recognition()}
              />
              <Toggle checked={speakReplies} onChange={setSpeak} label="Speak replies" disabled={!speechSupport.synthesis()} />
            </div>
            {turns.length > 0 ? (
              <Button
                variant="ghost"
                size="sm"
                icon="refresh"
                onClick={() => {
                  stopSpeaking();
                  setTurns([]);
                  history.current = [];
                }}
              >
                New conversation
              </Button>
            ) : null}
          </div>
        </form>
      </section>

      <aside className="console__inspector inspector" aria-label="MCP protocol inspector">
        <header className="inspector__header">
          <div>
            <h2 className="inspector__title">Protocol inspector</h2>
            <p className="inspector__subtitle">Live JSON-RPC over Streamable HTTP</p>
          </div>
          <Segmented<'trace' | 'tools'>
            label="Inspector view"
            size="sm"
            value={inspectorTab}
            onChange={setInspectorTab}
            options={[
              { value: 'trace', label: 'Trace' },
              { value: 'tools', label: `Tools ${host.tools.length || ''}`.trim() },
            ]}
          />
        </header>
        <dl className="inspector__session">
          <div>
            <dt>Server</dt>
            <dd>{host.info ? `${host.info.serverTitle ?? host.info.serverName} ${host.info.serverVersion}` : '...'}</dd>
          </div>
          <div>
            <dt>Protocol</dt>
            <dd className="mono">{host.info?.protocolVersion ?? '...'}</dd>
          </div>
          <div>
            <dt>Transport</dt>
            <dd>Streamable HTTP</dd>
          </div>
          <div>
            <dt>Endpoint</dt>
            <dd className="mono">{host.endpoint.pathname}</dd>
          </div>
        </dl>
        {inspectorTab === 'trace' ? <TraceList traces={host.traces} onClear={() => host.clearTrace()} /> : <ToolList host={host} />}
      </aside>
    </div>
  );
}

function TurnView({ turn, host, theme, onNote }: { turn: Turn; host: McpHost; theme: 'light' | 'dark'; onNote: (text: string) => void }) {
  if (turn.role === 'note') {
    return (
      <div className="turn turn--note">
        <Icon name="info" size={14} />
        <p>{turn.text}</p>
      </div>
    );
  }
  if (turn.role === 'user') {
    return (
      <div className="turn turn--user">
        <p className="bubble bubble--user">{turn.text}</p>
      </div>
    );
  }
  return (
    <div className="turn turn--assistant">
      <span className="turn__avatar" aria-hidden="true">
        <Icon name="microphone" size={16} />
      </span>
      <div className="turn__content">
        {turn.pending ? (
          <p className="bubble bubble--assistant bubble--pending" aria-label="Working on it">
            <span className="typing">
              <span />
              <span />
              <span />
            </span>
          </p>
        ) : (
          <>
            <p className="bubble bubble--assistant">{turn.text}</p>
            <div className="turn__meta">
              {turn.understood ? (
                <span className="turn__chip">
                  <Icon name="check" size={12} />
                  {turn.understood}
                </span>
              ) : null}
              {(turn.calls ?? []).map((call) => (
                <span key={call.id} className={`turn__chip turn__chip--tool${call.error || call.result?.isError ? ' turn__chip--error' : ''}`}>
                  <Icon name="terminal" size={12} />
                  <span className="mono">{call.name}</span>
                  <span className="turn__ms">{call.durationMs} ms</span>
                </span>
              ))}
              {turn.fallback ? (
                <span className="turn__chip turn__chip--warning" title={turn.fallback}>
                  <Icon name="warning" size={12} />
                  Bedrock unavailable, used the local engine
                </span>
              ) : null}
            </div>
            {host.cardHtml
              ? (turn.calls ?? [])
                  .filter((call) => call.result && !call.result.isError && host.toolHasCard(call.name))
                  .map((call) => (
                    <McpAppFrame
                      key={call.id}
                      host={host}
                      html={host.cardHtml!}
                      args={call.args}
                      result={call.result!}
                      theme={theme}
                      title={`${call.name} result card`}
                      onModelContext={onNote}
                    />
                  ))
              : null}
          </>
        )}
      </div>
    </div>
  );
}

function TraceList({ traces, onClear }: { traces: TraceEntry[]; onClear: () => void }) {
  const [open, setOpen] = useState<string | null>(null);
  if (traces.length === 0) {
    return <p className="inspector__empty">Requests appear here as the console talks to the server.</p>;
  }
  return (
    <div className="trace">
      <div className="trace__bar">
        <span>
          {traces.length} message{traces.length === 1 ? '' : 's'}
        </span>
        <button type="button" className="trace__clear" onClick={onClear}>
          Clear
        </button>
      </div>
      <ol className="trace__list">
        {traces.map((entry) => {
          const expanded = open === entry.id;
          return (
            <li key={entry.id} className={`trace__item trace__item--${entry.status}`}>
              <button type="button" className="trace__row" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : entry.id)}>
                <span className="trace__status" aria-hidden="true" />
                <span className="trace__method mono">{entry.method}</span>
                {entry.target ? <span className="trace__target mono">{entry.target}</span> : null}
                {entry.origin === 'card' ? <span className="trace__origin">card</span> : null}
                <span className="trace__time">{entry.status === 'pending' ? '...' : entry.durationMs !== undefined ? `${entry.durationMs} ms` : ''}</span>
                <Icon name={expanded ? 'chevronDown' : 'chevronRight'} size={14} className="trace__chevron" />
              </button>
              {expanded ? (
                <div className="trace__detail">
                  <p className="trace__label">Request</p>
                  <pre className="trace__json">{JSON.stringify(entry.request, null, 2)}</pre>
                  {entry.response !== undefined ? (
                    <>
                      <p className="trace__label">Response{entry.httpStatus ? ` · HTTP ${entry.httpStatus}` : ''}</p>
                      <pre className="trace__json">{JSON.stringify(entry.response, null, 2)}</pre>
                    </>
                  ) : entry.httpStatus ? (
                    <p className="trace__label">HTTP {entry.httpStatus}, no body</p>
                  ) : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function ToolList({ host }: { host: McpHost }) {
  return (
    <ul className="tool-list">
      {host.tools.map((tool) => {
        const annotations = tool.annotations ?? {};
        return (
          <li key={tool.name} className="tool-list__item">
            <div className="tool-list__head">
              <span className="tool-list__name mono">{tool.name}</span>
              {annotations.readOnlyHint ? <Badge tone="good">read only</Badge> : <Badge tone="warning">writes</Badge>}
              {annotations.idempotentHint && !annotations.readOnlyHint ? <Badge>idempotent</Badge> : null}
              {host.toolHasCard(tool.name) ? <Badge tone="accent">MCP App</Badge> : null}
            </div>
            <p className="tool-list__description">{tool.description}</p>
          </li>
        );
      })}
    </ul>
  );
}
