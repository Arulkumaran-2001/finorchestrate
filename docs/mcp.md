# MCP reference

- Endpoint: `POST /mcp` (Streamable HTTP). Stateless: each request is served by a fresh server instance, so `GET` (standalone SSE) answers 405.
- Protocol: 2025-11-25 (and earlier 2025 revisions) through the `initialize` handshake, and 2026-07-28 through `server/discover`.
- Authentication: `Authorization: Bearer <FINO_API_TOKEN>`. Missing or wrong tokens get HTTP 401 with a `WWW-Authenticate: Bearer` challenge.
- Server name `finorchestrate`, title "FinOrchestrate Budget Guardian". The `initialize` result includes instructions for the model (speak the `speech` field, ask before approving).

## Example exchange

```http
POST /mcp
Authorization: Bearer <token>
Content-Type: application/json
Accept: application/json, text/event-stream

{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"get_runway","arguments":{"stress_percent":25}}}
```

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "result": {
    "content": [
      { "type": "text", "text": "If spending rises 25 percent, net burn becomes about $3,922 a month against $39,045 in cash. That is 10.0 months of runway, which takes you to August 2027." },
      { "type": "text", "text": "{\"kind\":\"runway\", ...}" }
    ],
    "structuredContent": {
      "kind": "runway",
      "speech": "If spending rises 25 percent, ...",
      "cashCents": 3904512,
      "stressPercent": 25,
      "monthlyExpenseCents": 855604,
      "monthlyIncomeCents": 463430,
      "monthlyNetBurnCents": 392174,
      "months": 9.96,
      "zeroCashDate": "2027-08-12T08:30:00.000Z",
      "grossMonths": 4.56,
      "cashFlowPositive": false
    }
  }
}
```

## Tools

Arguments use US dollars; results use integer cents.

| Tool | Arguments | Annotations | Notes |
|---|---|---|---|
| `get_budget_status` | `category?` | read only, idempotent | Envelopes sorted by concern; `focusId` when a category is given |
| `log_expense` | `amount`, `description`, `category?`, `merchant?`, `occurred_on?` | write | Auto categorised; returns `anomaly` when it looks unusual |
| `log_income` | `amount`, `description`, `occurred_on?` | write | Returns new cash and runway |
| `get_runway` | `stress_percent?` | read only, idempotent | `months` is null when cash flow positive |
| `forecast_cash` | `months`, `stress_percent?` | read only, idempotent | Points with p10, p50, p90 |
| `audit_spending` | `days?`, `sensitivity?` | read only, idempotent | Findings with spoken reasons |
| `check_affordability` | `amount`, `description`, `category?`, `recurring?` | read only, idempotent | Verdict plus a transfer or wait suggestion |
| `move_budget` | `from_category`, `to_category`, `amount`, `reason?` | write | `approval_required` above the voice confirmation limit |
| `list_approvals` | none | read only, idempotent | Pending approvals |
| `resolve_approval` | `decision`, `approval_id?` | write | Defaults to the newest pending approval |
| `run_guardian` | none | write, idempotent | Sweep report |
| `get_briefing` | `listener?` | write | Advances the client's briefing cursor |
| `review_transaction` | `transaction_id` | write, idempotent | Clears a flag |

All tools declare `_meta.ui.resourceUri = "ui://finorchestrate/card.html"`.

## Resources

| URI | Type | Content |
|---|---|---|
| `ui://finorchestrate/card.html` | `text/html;profile=mcp-app` | The MCP App view |
| `finorchestrate://ledger/overview` | `application/json` | Cash, runway, envelopes, open items, guardian status |
| `finorchestrate://guardian/policy` | `application/json` | Autonomy limits, reserve floor, sensitivity, schedule |

## Prompts

| Name | Arguments | Purpose |
|---|---|---|
| `weekly_review` | none | Briefing, budget status and audit in four spoken sentences |
| `purchase_check` | `item`, `amount` | Affordability check that asks before moving money |

## The MCP App card

The card is a vanilla TypeScript view on the official `App` class from `@modelcontextprotocol/ext-apps`. It:

- renders every result `kind` (budget, expense, income, runway, forecast, audit, affordability, move, approvals, resolution, sweep, briefing, review),
- follows the host's light or dark theme from the host context,
- calls `resolve_approval`, `review_transaction` and `move_budget` through the host when its buttons are pressed, then sends an `ui/update-model-context` note so the conversation's model knows what the person did,
- reports its size after every render so the host can fit the frame.
