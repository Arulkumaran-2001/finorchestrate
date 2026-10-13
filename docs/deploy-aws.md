# Deploy on AWS

The SAM template in `infra/aws/template.yaml` creates:

| Resource | Purpose |
|---|---|
| Lambda function (container image, Function URL) | Dashboard, MCP endpoint, GraphQL and the guardian sweep, one Node server behind the Lambda Web Adapter |
| DynamoDB table (on demand, TTL, point in time recovery) | Ledger storage (`FINO_STORE=dynamodb`) |
| SNS topic, optional email subscription | Guardian alerts: autonomous moves, approval requests, unusual charges |
| EventBridge Scheduler schedule | Invokes the function every hour; the adapter forwards the event to `/internal/guardian-sweep` |
| IAM roles | DynamoDB CRUD on the table, SNS publish, Bedrock `InvokeModel`, scheduler invoke |

## Prerequisites

- An AWS account, the AWS CLI configured, AWS SAM CLI and Docker.
- For the Bedrock planner: enable access to your chosen model in the Amazon Bedrock console (Model access) in the deployment region. The default is `amazon.nova-lite-v1:0`. Some models must be called through an inference profile id such as `us.amazon.nova-lite-v1:0`; set `BedrockModelId` accordingly. Leave it empty to use the local intent engine only.

## Deploy

```bash
sam build --template infra/aws/template.yaml
```

```bash
sam deploy --guided --template .aws-sam/build/template.yaml
```

Answer the prompts:

- `ApiToken`: a long random string (for example `openssl rand -base64 32`). It is the bearer token for MCP clients and the dashboard access key.
- `SessionSecret`: another long random string.
- `AlertEmail`: optional; confirm the subscription email SNS sends you.
- `DemoMode`: `true` only for a public demo with sample data.

The outputs print `DashboardUrl` and `McpEndpoint`. Open the dashboard, sign in with the API token, and register the MCP endpoint with your Alexa+ connector or MCP client.

On a new table the server seeds the Lumen Labs demo ledger on first start. To begin from your own numbers, sign in and edit the envelopes, or replace the seed with `createEmptyLedger` in `apps/server/src/runtime.ts`.

## Run the same image elsewhere

```bash
docker build -t finorchestrate .
```

```bash
docker run -p 8080:8080 -e FINO_API_TOKEN=change-me-to-a-long-random-string -e FINO_PUBLIC_URL=http://localhost:8080 -v finorchestrate-data:/app/data finorchestrate
```

The Lambda Web Adapter extension in the image is inert outside Lambda. On a single container the in process scheduler runs the guardian.

## Cost notes

At a small team's volume the serverless pieces cost cents a month: Lambda requests, on demand DynamoDB and SNS stay within or near the free tier, and the hourly schedule is about 730 invocations a month. Amazon Bedrock is billed per token; the console only calls it when someone talks to it, and Nova Lite is one of the least expensive models. Set an AWS Budgets alert before deploying.

## Operations

- Logs: CloudWatch Logs for the function. Every guardian sweep logs its spoken summary.
- Pause the guardian from the dashboard (Guardian page) or with the `enabled` policy flag; scheduled sweeps then return `skipped: paused`.
- Rotate the API token by updating the `ApiToken` parameter and redeploying; existing dashboard sessions stay valid until they expire because they are signed with `SessionSecret`.
