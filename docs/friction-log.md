# Friction log

Problems hit while building FinOrchestrate on the Alexa+ track tools (MCP TypeScript SDK v2, MCP Apps) and AWS, with what I tried, what happened and how I worked around it. Severity: High blocks the goal, Medium costs hours or forces a workaround, Low is an annoyance.

## 1. No documented way to attach a self hosted MCP server to Alexa+

- **Task:** Connect my MCP server to a real Alexa+ device or account for the demo.
- **Steps:** Read the hackathon Resources page, the Alexa+ track text and the MCP getting started docs; looked for an Alexa+ connector console or developer preview for self hosted servers.
- **Expected:** A page that says where to register an MCP endpoint and token, which auth Alexa+ requires, and whether it works from India.
- **Actual:** The Resources page links the MCP spec and Agent Skills, and says the experience can be simulated in a web app. I found no registration flow for self hosted servers.
- **Severity:** High
- **Workaround:** Built the server to the spec (Streamable HTTP, 2025-11-25 and 2026-07-28, bearer auth) and a browser host that behaves like an Alexa+ connector: official MCP client SDK, MCP Apps rendering, voice in and out.
- **Suggestion:** Publish the Alexa+ connector requirements (supported protocol revisions, auth model, MCP Apps support, regions) and a test console, even an invite only one, for hackathon builders.

## 2. MCP Apps views report no size in background tabs

- **Task:** Size the iframe of my MCP App card to its content.
- **Steps:** Used `App` with the default `autoResize`, and `AppBridge.onsizechange` in my host.
- **Expected:** The host receives `ui/notifications/size-changed` once the view renders.
- **Actual:** The SDK measures inside `requestAnimationFrame`. Browsers pause animation frames for iframes in hidden or background tabs, so the host kept the placeholder height until the tab became visible. In automated tests the frame stayed collapsed.
- **Severity:** Medium
- **Workaround:** The view also measures synchronously after every render and calls `sendSizeChanged`; the host falls back to a fixed height if no size arrives within two seconds.
- **Suggestion:** Send an initial size without waiting for an animation frame, or document the behavior next to `autoResize`.

## 3. Sandboxed `srcdoc` views inherit the host page's Content Security Policy

- **Task:** Render the single file MCP App view in a sandboxed iframe on a page with a strict CSP.
- **Steps:** `iframe sandbox="allow-scripts"` with `srcdoc` set to the resource HTML.
- **Expected:** The view's own inline script runs inside its sandbox.
- **Actual:** `srcdoc` documents inherit the parent's policy, so `script-src 'self'` blocks the view's inline bundle.
- **Severity:** Medium
- **Workaround:** The server hashes the view's inline scripts at startup and adds exactly those hashes to the page's `script-src`.
- **Suggestion:** Mention CSP inheritance in the host guide, and ship the sandbox proxy page from the reference host as a reusable package.

## 4. No hook to observe tool calls a view makes through `AppBridge`

- **Task:** Show tool calls made by a card (Approve, Reject) in my protocol inspector and tag them as card initiated.
- **Steps:** Passed my MCP `Client` to `AppBridge`, then set `oncalltool` to wrap the call.
- **Expected:** A way to observe or wrap forwarded requests.
- **Actual:** Setting `oncalltool` after `connect()` replaces the automatic forwarding and logs "oncalltool handler replaced" on every card.
- **Severity:** Low
- **Workaround:** Construct `AppBridge` with a `null` client and implement `oncalltool` explicitly through my traced client.
- **Suggestion:** An `onrequest` middleware or an option to wrap forwarding, so hosts can log and audit view actions.

## 5. Which protocol revision does SDK v2 serve?

- **Task:** Confirm the server meets the track minimum of MCP 2025-11-25.
- **Steps:** Read the `@modelcontextprotocol/server` README, which says it implements 2026-07-28.
- **Expected:** A clear list of supported revisions.
- **Actual:** I had to read the protocol versions guide and the SDK constants to learn that `createMcpHandler` also serves 2025-era clients (up to 2025-11-25) statelessly by default.
- **Severity:** Low
- **Workaround:** Added protocol tests that connect with both the default (2025) client and `versionNegotiation: { mode: 'auto' }` (2026-07-28).
- **Suggestion:** List supported protocol revisions in each package README.

## 6. Stateless servers answer the client's optional SSE stream with 405

- **Task:** Run a browser MCP host against a stateless `createMcpHandler` endpoint.
- **Actual:** The 2025-era client opens the optional standalone `GET` stream, the stateless server answers 405, and browsers log it as a failed request on every connect.
- **Severity:** Low
- **Workaround:** The browser host answers that optional GET locally with 405, since it always talks to its own stateless server. The client continues correctly either way.
- **Suggestion:** Let the client skip the standalone stream when the server is known to be stateless, or document that the 405 is expected.

## 7. No AWS credits left for deployment testing

- **Task:** Deploy the SAM template (Lambda container, DynamoDB, SNS, EventBridge Scheduler, Bedrock).
- **Actual:** The hackathon's AWS credit codes ran out on October 7, before I could request one.
- **Severity:** Medium
- **Workaround:** Covered the DynamoDB repository, Bedrock Converse planner and SNS notifier with tests against mocked AWS clients, and made every AWS integration optional so the project runs fully locally.
- **Suggestion:** Reserve a small credit pool for late joiners, or point to the free tier limits for each service the tracks recommend.
