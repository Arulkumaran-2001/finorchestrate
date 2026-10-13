import { useEffect, useRef, useState } from 'react';
import { AppBridge, PostMessageTransport } from '@modelcontextprotocol/ext-apps/app-bridge';
import type { CallToolResult } from '@modelcontextprotocol/client';
import type { McpHost } from './host';

interface McpAppFrameProps {
  host: McpHost;
  html: string;
  args: Record<string, unknown>;
  result: CallToolResult;
  theme: 'light' | 'dark';
  title: string;
  onModelContext?: (text: string) => void;
}

/**
 * Hosts one MCP App view. The view runs in a sandboxed iframe with an opaque
 * origin (scripts only, no same-origin access), and talks to this page solely
 * through the AppBridge postMessage protocol. Tool calls it makes are forwarded
 * to the MCP server through the host's client.
 */
export function McpAppFrame({ host, html, args, result, theme, title, onModelContext }: McpAppFrameProps) {
  const frame = useRef<HTMLIFrameElement>(null);
  const bridgeRef = useRef<AppBridge | null>(null);
  const [height, setHeight] = useState(220);
  const [ready, setReady] = useState(false);
  const sized = useRef(false);

  useEffect(() => {
    const iframe = frame.current;
    if (!iframe?.contentWindow) return;
    let disposed = false;
    // The bridge gets no client of its own: the one capability a card uses, calling tools, is wired
    // explicitly below so those calls go through the traced client and are tagged as coming from the card.
    const bridge = new AppBridge(
      null,
      { name: 'FinOrchestrate voice console', version: '1.0.0' },
      { serverTools: {}, logging: {}, openLinks: {}, updateModelContext: { text: {} } },
      {
        hostContext: {
          theme,
          platform: 'web',
          displayMode: 'inline',
          availableDisplayModes: ['inline'],
          locale: navigator.language,
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          containerDimensions: { width: iframe.clientWidth || 560, maxHeight: 900 },
        },
      },
    );
    bridgeRef.current = bridge;
    bridge.oninitialized = () => {
      if (disposed) return;
      void bridge.sendToolInput({ arguments: args });
      void bridge.sendToolResult(result);
      setReady(true);
      // A view that never reports its size still gets a readable, scrollable frame.
      window.setTimeout(() => {
        if (!disposed && !sized.current) setHeight(480);
      }, 2000);
    };
    bridge.onsizechange = ({ height: next }) => {
      if (typeof next === 'number' && next > 0) {
        sized.current = true;
        setHeight(Math.min(1200, Math.ceil(next) + 4));
      }
    };
    bridge.onupdatemodelcontext = async (params) => {
      const text = (params.content ?? []).map((block) => ('text' in block ? String(block.text) : '')).join(' ').trim();
      if (text) onModelContext?.(text);
      return {};
    };
    bridge.onopenlink = async ({ url }) => {
      if (/^https?:\/\//.test(url)) window.open(url, '_blank', 'noopener,noreferrer');
      return {};
    };
    bridge.oncalltool = async (params) => host.asCard(async () => (await host.client.callTool(params)) as CallToolResult);
    const transport = new PostMessageTransport(iframe.contentWindow, iframe.contentWindow);
    void bridge.connect(transport).then(() => {
      if (!disposed) iframe.srcdoc = html;
    });
    return () => {
      disposed = true;
      void bridge.teardownResource({}).catch(() => undefined);
      void bridge.close().catch(() => undefined);
      bridgeRef.current = null;
    };
    // The view is created once per tool result; later prop changes are pushed below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (ready) void bridgeRef.current?.sendHostContextChange({ theme });
  }, [theme, ready]);

  return (
    <iframe
      ref={frame}
      className={`app-frame${ready ? ' app-frame--ready' : ''}`}
      title={title}
      sandbox="allow-scripts"
      style={{ height }}
      referrerPolicy="no-referrer"
    />
  );
}
