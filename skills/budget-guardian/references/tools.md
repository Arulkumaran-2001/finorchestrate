# FinOrchestrate MCP tools

All amounts in arguments are US dollars. All amounts in results are integer US cents (`...Cents`). Every result's `structuredContent` has `kind` and `speech`.

| Tool | Arguments | Result `kind` | Annotations |
|---|---|---|---|
| `get_budget_status` | `category?` | `budget` | read only |
| `log_expense` | `amount`, `description`, `category?`, `merchant?`, `occurred_on?` (YYYY-MM-DD) | `expense` | writes |
| `log_income` | `amount`, `description`, `occurred_on?` | `income` | writes |
| `get_runway` | `stress_percent?` (-90 to 300) | `runway` | read only |
| `forecast_cash` | `months` (1 to 12), `stress_percent?` | `forecast` | read only |
| `audit_spending` | `days?` (default 45), `sensitivity?` (1.5 to 10) | `audit` | read only |
| `check_affordability` | `amount`, `description`, `category?`, `recurring?` | `affordability` | read only |
| `move_budget` | `from_category`, `to_category`, `amount`, `reason?` | `move` | writes |
| `list_approvals` | none | `approvals` | read only |
| `resolve_approval` | `decision` (`approve` or `reject`), `approval_id?` (defaults to the newest pending) | `resolution` | writes |
| `run_guardian` | none | `sweep` | writes, idempotent |
| `get_briefing` | `listener?` (separate memory per person or device) | `briefing` | writes a read cursor |
| `review_transaction` | `transaction_id` | `review` | writes, idempotent |

## Envelope references

Category arguments accept an id or a spoken name:

| Id | Name | Also understood as |
|---|---|---|
| `cloud` | Cloud & Infrastructure | AWS, Bedrock, Lambda, S3, EC2, GPU, hosting |
| `tooling` | Dev Tools & SaaS | GitHub, Datadog, Sentry, Figma, subscriptions |
| `contractors` | Contractors | freelance, designer, consultant |
| `marketing` | Marketing | ads, campaign, sponsorship, newsletter |
| `operations` | Operations | legal, accounting, coworking, fees |
| `reserve` | Safety Reserve | emergency, cushion, buffer |

## Result highlights

- `runway.months` is `null` when income covers spending.
- `forecast.points[]` carries `p10Cents`, `p50Cents` and `p90Cents` per month; `shortfallProbability` is 0 to 1.
- `affordability.verdict` is `comfortable`, `tight` or `not-advised`; `suggestion` is a transfer to make room or a date to wait for.
- `move.status` is `executed` or `approval_required` (with `approvalId`).
- `sweep` lists what the guardian `executed` on its own, the `approvals` it requested and the charges it `flagged`.

## Resources and prompts

- `finorchestrate://ledger/overview`: cash, runway, envelope health and open items as JSON.
- `finorchestrate://guardian/policy`: autonomy limits, reserve floor and anomaly sensitivity.
- `ui://finorchestrate/card.html`: the MCP App view for every tool result.
- Prompts: `weekly_review`, `purchase_check` (`item`, `amount`).
