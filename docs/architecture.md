# Architecture

FinOrchestrate is one domain service with several doors into it. The MCP endpoint, the GraphQL API and the scheduled guardian all call the same `FinanceService`, so every surface shares the same rules, the same audit trail and the same spoken phrasing.

## Components

| Part | Role |
|---|---|
| `packages/core` | Domain model and all calculations. No framework, no I/O beyond the repository interface. |
| `apps/server` | Node HTTP server: MCP (`/mcp`), GraphQL (`/graphql`), sessions and the Bedrock planner (`/api/*`), scheduled sweeps (`/internal/guardian-sweep`), static dashboard. |
| `apps/card` | MCP App view, one HTML file served as `ui://finorchestrate/card.html`. |
| `apps/web` | React dashboard and the voice console (a browser MCP host). |
| `packages/icons` | Icon set shared by the dashboard and the card. |

## Data model

- **Workspace**: name, opening balance, envelopes (categories), guardian policy, briefing cursors per client.
- **Transaction**: amount in integer cents, direction, envelope, merchant, source (`import`, `voice`, `dashboard`, `api`), status (`cleared` or `flagged` with an anomaly finding).
- **Budget transfer**: a move of monthly limit between two envelopes for one period, with actor and reason.
- **Approval**: proposed transfer legs waiting for a decision, with rationale and expiry.
- **Activity event**: the audit trail. Every write records who did it (owner, assistant, guardian) and why.

Writes go through a `ChangeSet` so the file store rewrites one document atomically and the DynamoDB store issues batched writes (single table: `pk = WS#<id>`, `sk = META | TX#<id> | TRF#<id> | APR#<id> | ACT#<at>#<id>`, activity expires through TTL).

## Calculations

### Month end projection

Cloud invoices land in the first days of a month and contractor invoices mid month, so a straight line from spend to date is wrong. For each envelope:

```
projected = spent so far + R x pace
```

- `R` is the average spend in the rest of the month across the last three complete months, measured from the same point in the month.
- `pace = clamp(1 + 0.5 x (spentSoFar / typicalSpendToDate - 1), 0.85, 1.35)` passes through half of an unusual pace, so a hot month projects hotter without one spike doubling the forecast.
- Without history the projection falls back to the current daily pace. Reserves are not projected.

Health is `over` (spent above limit), `at-risk` (projected above limit), `watch` (at the alert threshold or projected above 92%) or `healthy`.

### Runway and forecast

- Burn uses the last three complete months: average expenses minus average income. Runway is cash divided by net burn; when income covers spending it is reported as cash positive. A stress percent scales expenses.
- The cash forecast treats monthly net burn as a random walk. The median path moves by the average burn; the 10th to 90th percentile band widens with the square root of time using observed month to month volatility (floored at 12% of gross spend). The shortfall probability is the normal probability that cash at the horizon is below zero.

### Anomaly detection

For each expense, in order:

1. **Duplicate**: same merchant and same amount within three days.
2. **Merchant outlier**: with four or more prior charges from the merchant, an Iglewicz and Hoaglin modified z-score (median and median absolute deviation) at or above the sensitivity (3.5 by default), at least 1.3 times the typical amount and $25 above it.
3. **Short but consistent history** vouches for a charge up to 1.5 times its largest prior amount.
4. **Category outlier or new merchant**: against the envelope's last 150 days, a stricter threshold, at least twice the median and above the 90th percentile.

Every finding carries a one sentence reason that is spoken as is.

### Guardian sweep

`planSweep` is a pure function, so it is unit tested and could be shown as a dry run:

1. Expire stale approvals.
2. For each operating envelope projected above its limit (largest gap first), round the gap up to the next $10.
3. Find donors: reserves give anything above the reserve floor; operating envelopes give only slack beyond their own projection plus a 10% cushion. Reserve first, then the envelope with the most slack.
4. If the gap is fully covered, within the per move autonomy limit and within the monthly autonomy cap, move it and record why. Otherwise create an approval with the proposed legs and the reason it needs a person.
5. Planned legs reduce donor capacity for later envelopes, so two gaps never spend the same slack.
6. Flag unusual charges from the last 45 days that are not flagged or reviewed yet.

A second sweep right after the first finds nothing to do, which is what makes it safe to schedule.

## The MCP server

- Built with the official TypeScript SDK v2 (`@modelcontextprotocol/server`). `createMcpHandler` builds a fresh server per request from a factory, which serves both the 2025 era (`initialize` handshake, up to 2025-11-25) and the 2026-07-28 era (`server/discover`) statelessly. That makes the same code run in one Node process or on AWS Lambda.
- Tools are registered with `registerAppTool` from `@modelcontextprotocol/ext-apps` so each one points at the card resource. Input schemas are zod, output schemas validate `structuredContent` before it leaves the server.
- Results carry three renderings: the spoken line, the JSON for older clients, and `structuredContent` for hosts and the card.
- Domain problems come back as `isError` tool results with a message written to be spoken, so a model can recover.

## The voice console (browser MCP host)

- Connects with the official client SDK over Streamable HTTP, through a fetch wrapper that records every JSON-RPC exchange for the protocol inspector.
- Planner: the local intent engine (deterministic, offline) or, when `FINO_BEDROCK_MODEL_ID` is set, a tool use loop where the server calls Amazon Bedrock's Converse API with the MCP tool list and the browser executes each requested tool over MCP.
- Cards render in `iframe sandbox="allow-scripts"` (opaque origin) and talk to the page only through the MCP Apps `AppBridge` postMessage protocol. Tool calls a card makes go through the same traced MCP client and are tagged as coming from the card.
- The page's Content Security Policy allows exactly the card's inline script by hash, which the sandboxed `srcdoc` frame inherits.

## Security

- MCP clients use a bearer token compared in constant time. The dashboard uses an HMAC signed, HttpOnly, SameSite=Strict session cookie (Secure behind HTTPS).
- Host and Origin validation on `/mcp`, `/graphql` and `/api` blocks DNS rebinding; suffix wildcards support managed hostnames.
- GraphQL accepts only JSON posts and event stream subscriptions, so a cross site form cannot reach it.
- Sign in and the planner are rate limited; request bodies are size limited.
- Voice initiated moves above a confirmation limit and guardian moves above its autonomy limit always wait for an explicit approval.

## Known limits

- One workspace per deployment. The repository is keyed by workspace id, so multi tenancy is a routing change, not a data model change.
- Live dashboard updates use an in memory event bus. On AWS Lambda, changes made by another instance appear on the next refresh rather than instantly.
- Voice input relies on the browser's Web Speech API, available in Chromium based browsers. Typing works everywhere.
