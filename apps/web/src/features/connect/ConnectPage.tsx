import { useState } from 'react';
import { Button } from '../../components/Button';
import { ErrorNotice, PageHeader, Panel, Skeleton } from '../../components/display';
import { Segmented } from '../../components/forms';
import { Icon, type IconName } from '../../components/Icon';
import { ConfirmDialog, useToast } from '../../components/overlays';
import { Badge } from '../../components/Status';
import { CONNECTION_QUERY, RESET_DEMO, REVEAL_TOKEN, type Connection } from '../../lib/api';
import { useMutation, useQuery } from '../../lib/graphql';
import { McpHost } from '../../mcp/host';
import './connect.css';

type Snippet = 'json' | 'curl' | 'inspector';

async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function CodeBlock({ code, label }: { code: string; label: string }) {
  const toast = useToast();
  return (
    <div className="code-block">
      <div className="code-block__bar">
        <span>{label}</span>
        <Button
          size="sm"
          variant="ghost"
          icon="copy"
          onClick={async () => toast((await copy(code)) ? { title: 'Copied', detail: label, tone: 'success' } : { title: 'Copy failed', detail: 'Select the text and copy it manually.', tone: 'warning' })}
        >
          Copy
        </Button>
      </div>
      <pre className="code-block__body">
        <code>{code}</code>
      </pre>
    </div>
  );
}

interface CheckResult {
  ok: boolean;
  protocol: string | null;
  tools: number;
  ms: number;
  error?: string;
}

export default function ConnectPage() {
  const query = useQuery<{ connection: Connection }>(CONNECTION_QUERY);
  const reveal = useMutation<{ revealApiToken: string }>(REVEAL_TOKEN);
  const reset = useMutation<{ resetDemoData: boolean }>(RESET_DEMO);
  const toast = useToast();
  const [token, setToken] = useState<string | null>(null);
  const [snippet, setSnippet] = useState<Snippet>('json');
  const [check, setCheck] = useState<CheckResult | null>(null);
  const [checking, setChecking] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

  if (query.error && !query.data) return <ErrorNotice message={query.error.message} onRetry={query.refetch} />;
  const connection = query.data?.connection;
  const shownToken = token ?? '<YOUR_FINO_API_TOKEN>';

  const runCheck = async () => {
    setChecking(true);
    const host = new McpHost();
    const started = performance.now();
    await host.connect();
    setCheck(
      host.status === 'ready'
        ? { ok: true, protocol: host.info?.protocolVersion ?? null, tools: host.tools.length, ms: Math.round(performance.now() - started) }
        : { ok: false, protocol: null, tools: 0, ms: Math.round(performance.now() - started), error: host.error ?? 'Unknown error' },
    );
    await host.close();
    setChecking(false);
  };

  const revealToken = async () => {
    try {
      const result = await reveal.run();
      setToken(result.revealApiToken);
    } catch (error) {
      toast({ title: 'Could not reveal the token', detail: (error as Error).message, tone: 'critical' });
    }
  };

  const snippets: Record<Snippet, { label: string; code: string }> = {
    json: {
      label: 'Remote MCP server configuration',
      code: JSON.stringify(
        { mcpServers: { finorchestrate: { type: 'http', url: connection?.mcpUrl ?? '', headers: { Authorization: `Bearer ${shownToken}` } } } },
        null,
        2,
      ),
    },
    curl: {
      label: 'Initialize with curl',
      code: `curl -s ${connection?.mcpUrl ?? ''} \\
  -H "Authorization: Bearer ${shownToken}" \\
  -H "Content-Type: application/json" \\
  -H "Accept: application/json, text/event-stream" \\
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"curl","version":"1.0.0"}}}'`,
    },
    inspector: {
      label: 'Open in MCP Inspector',
      code: `npx @modelcontextprotocol/inspector
# Transport: Streamable HTTP
# URL: ${connection?.mcpUrl ?? ''}
# Header: Authorization: Bearer ${shownToken}`,
    },
  };

  const capabilities: Array<{ icon: IconName; title: string; text: string }> = [
    { icon: 'terminal', title: '13 tools', text: 'Typed input and output schemas, read only and idempotent hints, voice ready speech in every result.' },
    { icon: 'overview', title: 'MCP App card', text: 'ui://finorchestrate/card.html renders every result with approve, reject and review actions.' },
    { icon: 'receipt', title: '3 resources', text: 'Ledger overview, guardian policy and the card view, readable by any host.' },
    { icon: 'microphone', title: '2 prompts', text: 'weekly_review and purchase_check, ready for slash commands or voice shortcuts.' },
    { icon: 'shield', title: 'Agent Skill', text: 'skills/budget-guardian teaches any agent how to run a spoken budget review with these tools.' },
    { icon: 'lock', title: 'Bearer auth', text: 'Host and Origin validation against DNS rebinding, constant time token checks, rate limits.' },
  ];

  return (
    <div className="connect">
      <PageHeader title="Connect" description="Plug FinOrchestrate into Alexa+ or any MCP client. One endpoint serves MCP 2025-11-25 and 2026-07-28 over Streamable HTTP." />
      <div className="grid grid--two">
        <div className="stack">
          <Panel
            title="MCP endpoint"
            subtitle="Streamable HTTP, bearer token authentication"
            icon="plug"
            id="endpoint"
            actions={
              <Button size="sm" icon="pulse" loading={checking} onClick={() => void runCheck()}>
                Test connection
              </Button>
            }
          >
            {!connection ? (
              <Skeleton height={120} radius={12} />
            ) : (
              <>
                <div className="endpoint">
                  <code className="endpoint__url">{connection.mcpUrl}</code>
                  <Button
                    size="sm"
                    variant="ghost"
                    icon="copy"
                    iconOnlyLabel="Copy endpoint URL"
                    onClick={async () => toast((await copy(connection.mcpUrl)) ? { title: 'Endpoint copied', tone: 'success' } : { title: 'Copy failed', tone: 'warning' })}
                  />
                </div>
                <div className="endpoint__badges">
                  <Badge tone="accent">{connection.transport}</Badge>
                  {connection.protocolVersions.map((version) => (
                    <Badge key={version} tone="good">
                      MCP {version}
                    </Badge>
                  ))}
                </div>
                {check ? (
                  <p className={`check-result check-result--${check.ok ? 'ok' : 'error'}`} role="status">
                    <Icon name={check.ok ? 'success' : 'critical'} size={16} />
                    {check.ok ? `Connected in ${check.ms} ms. Negotiated ${check.protocol}, ${check.tools} tools listed.` : `Connection failed: ${check.error}`}
                  </p>
                ) : null}
                <div className="token">
                  <div className="token__text">
                    <p className="token__label">API token</p>
                    <code className="token__value">{token ?? connection.tokenPreview}</code>
                    <p className="token__hint">
                      {connection.tokenSource === 'env' ? 'Set through FINO_API_TOKEN.' : 'Generated on first start and stored in data/secrets.json. Set FINO_API_TOKEN to choose your own.'}
                    </p>
                  </div>
                  <div className="token__actions">
                    {token ? (
                      <>
                        <Button size="sm" icon="eyeOff" onClick={() => setToken(null)}>
                          Hide
                        </Button>
                        <Button size="sm" variant="primary" icon="copy" onClick={async () => toast((await copy(token)) ? { title: 'Token copied', tone: 'success' } : { title: 'Copy failed', tone: 'warning' })}>
                          Copy
                        </Button>
                      </>
                    ) : (
                      <Button size="sm" icon="eye" loading={reveal.pending} onClick={() => void revealToken()}>
                        Reveal
                      </Button>
                    )}
                  </div>
                </div>
              </>
            )}
          </Panel>

          <Panel title="Client setup" subtitle={token ? 'Your token is filled in below.' : 'Reveal the token to fill it into the snippets.'} icon="code" id="setup">
            <Segmented<Snippet>
              label="Snippet"
              size="sm"
              value={snippet}
              onChange={setSnippet}
              options={[
                { value: 'json', label: 'MCP client' },
                { value: 'curl', label: 'curl' },
                { value: 'inspector', label: 'Inspector' },
              ]}
            />
            <CodeBlock code={snippets[snippet].code} label={snippets[snippet].label} />
            <ol className="steps">
              <li>Deploy the server where Alexa+ can reach it over HTTPS, or tunnel your local port.</li>
              <li>Set FINO_PUBLIC_URL to that address so Host and Origin checks allow it.</li>
              <li>Register the endpoint and bearer token in the Alexa+ connector or your MCP client.</li>
              <li>Ask: "What did I miss?" The briefing remembers what this client already heard.</li>
            </ol>
          </Panel>
        </div>

        <div className="stack">
          <Panel title="What the server exposes" subtitle="Discoverable through tools/list, resources/list and prompts/list" icon="terminal" id="capabilities">
            <ul className="capabilities">
              {capabilities.map((item) => (
                <li key={item.title} className="capabilities__item">
                  <span className="capabilities__icon">
                    <Icon name={item.icon} size={18} />
                  </span>
                  <div>
                    <p className="capabilities__title">{item.title}</p>
                    <p className="capabilities__text">{item.text}</p>
                  </div>
                </li>
              ))}
            </ul>
          </Panel>

          <Panel title="This server" icon="sliders" id="system">
            {!connection ? (
              <Skeleton height={160} radius={12} />
            ) : (
              <dl className="system">
                <div>
                  <dt>Storage</dt>
                  <dd>{connection.store === 'dynamodb' ? 'Amazon DynamoDB' : connection.store === 'file' ? 'Local JSON file' : 'In memory'}</dd>
                </div>
                <div>
                  <dt>Voice planner</dt>
                  <dd>{connection.planner.kind === 'bedrock' ? `Amazon Bedrock, ${connection.planner.model}` : 'Local intent engine'}</dd>
                </div>
                <div>
                  <dt>Notifications</dt>
                  <dd>{connection.notifications.join(', ')}</dd>
                </div>
                <div>
                  <dt>Guardian schedule</dt>
                  <dd>{connection.guardianSchedule ? 'In process' : 'EventBridge Scheduler'}</dd>
                </div>
                <div>
                  <dt>Mode</dt>
                  <dd>{connection.demoMode ? 'Demo, one click sign in' : 'Private, access key only'}</dd>
                </div>
                <div>
                  <dt>Version</dt>
                  <dd>{connection.version}</dd>
                </div>
              </dl>
            )}
            {connection?.demoMode ? (
              <div className="reset">
                <div>
                  <p className="reset__title">Reset demo data</p>
                  <p className="reset__text">Restores the Lumen Labs ledger, envelopes and guardian history. The API token stays the same.</p>
                </div>
                <Button variant="danger" icon="refresh" onClick={() => setConfirmReset(true)}>
                  Reset
                </Button>
              </div>
            ) : null}
          </Panel>
        </div>
      </div>
      <ConfirmDialog
        open={confirmReset}
        title="Reset the demo ledger?"
        description="Every change made since the server started is replaced with the sample team's data."
        confirmLabel="Reset demo data"
        tone="danger"
        pending={reset.pending}
        onClose={() => setConfirmReset(false)}
        onConfirm={async () => {
          try {
            await reset.run();
            toast({ title: 'Demo data restored', tone: 'success' });
          } catch (error) {
            toast({ title: 'Reset failed', detail: (error as Error).message, tone: 'critical' });
          }
          setConfirmReset(false);
        }}
      />
    </div>
  );
}
