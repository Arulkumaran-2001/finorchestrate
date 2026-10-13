import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export type StoreKind = 'file' | 'memory' | 'dynamodb';

export interface AppConfig {
  host: string;
  port: number;
  /** Public origin, for example https://finorchestrate.example.com. Used for host checks and the MCP URL shown in the UI. */
  publicUrl: string | null;
  allowedHosts: string[];
  apiToken: string;
  apiTokenSource: 'env' | 'generated';
  sessionSecret: string;
  /** Shared secret in the EventBridge schedule payload for /internal/guardian-sweep. */
  schedulerSecret: string;
  demoMode: boolean;
  store: StoreKind;
  dataDir: string;
  dynamoTable: string | null;
  awsRegion: string | null;
  bedrockModelId: string | null;
  snsTopicArn: string | null;
  webhookUrl: string | null;
  guardianSchedule: boolean;
  /** Minutes to wait after boot before the first scheduled sweep. */
  guardianStartDelayMinutes: number;
  webDist: string | null;
  viewsDir: string;
  production: boolean;
  version: string;
}

const here = path.dirname(fileURLToPath(import.meta.url));
/** apps/server, whether running from src with tsx or from the bundled dist folder. */
const serverRoot = path.resolve(here, '..');
const repoRoot = path.resolve(serverRoot, '..', '..');

function bool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

function text(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/**
 * Secrets that are not provided through the environment are generated once and
 * kept in the data directory, so MCP clients keep working across restarts.
 */
function persistentSecret(dataDir: string, name: string): string {
  const file = path.join(dataDir, 'secrets.json');
  let secrets: Record<string, string> = {};
  if (existsSync(file)) {
    try {
      secrets = JSON.parse(readFileSync(file, 'utf8')) as Record<string, string>;
    } catch {
      secrets = {};
    }
  }
  if (!secrets[name]) {
    secrets[name] = randomBytes(24).toString('base64url');
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(file, JSON.stringify(secrets, null, 2), { mode: 0o600 });
  }
  return secrets[name]!;
}

/** Load the repository .env file when present. Real environment variables always win. */
export function loadEnvFile(): void {
  const file = path.join(repoRoot, '.env');
  if (!existsSync(file)) return;
  const before = { ...process.env };
  process.loadEnvFile(file);
  for (const [key, value] of Object.entries(before)) process.env[key] = value;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const production = env.NODE_ENV === 'production';
  const dataDir = path.resolve(repoRoot, env.FINO_DATA_DIR ?? 'data');
  const store = (env.FINO_STORE ?? 'file') as StoreKind;
  if (!['file', 'memory', 'dynamodb'].includes(store)) {
    throw new Error(`FINO_STORE must be file, memory or dynamodb. Received "${store}".`);
  }
  const dynamoTable = text(env.FINO_DYNAMODB_TABLE);
  if (store === 'dynamodb' && !dynamoTable) throw new Error('FINO_DYNAMODB_TABLE is required when FINO_STORE=dynamodb.');

  const envToken = text(env.FINO_API_TOKEN);
  if (production && !envToken) throw new Error('FINO_API_TOKEN must be set in production.');
  if (envToken && envToken.length < 16) throw new Error('FINO_API_TOKEN must be at least 16 characters.');
  const canPersist = store !== 'dynamodb';
  const apiToken = envToken ?? (canPersist ? persistentSecret(dataDir, 'apiToken') : randomBytes(24).toString('base64url'));
  const sessionSecret = text(env.FINO_SESSION_SECRET) ?? (canPersist ? persistentSecret(dataDir, 'sessionSecret') : apiToken);

  const publicUrl = text(env.FINO_PUBLIC_URL)?.replace(/\/+$/, '') ?? null;
  const allowedHosts = new Set(['localhost', '127.0.0.1', '[::1]']);
  if (publicUrl) allowedHosts.add(new URL(publicUrl).hostname);
  for (const host of (env.FINO_ALLOWED_HOSTS ?? '').split(',').map((entry) => entry.trim()).filter(Boolean)) {
    allowedHosts.add(host);
  }

  const webDistCandidate = path.resolve(repoRoot, env.FINO_WEB_DIST ?? 'apps/web/dist');
  const viewsDir = path.resolve(repoRoot, env.FINO_VIEWS_DIR ?? 'apps/server/views');

  return {
    host: env.HOST ?? (production ? '0.0.0.0' : '127.0.0.1'),
    port: Number(env.PORT ?? 8787),
    publicUrl,
    allowedHosts: [...allowedHosts],
    apiToken,
    apiTokenSource: envToken ? 'env' : 'generated',
    sessionSecret,
    schedulerSecret: text(env.FINO_SCHEDULER_SECRET) ?? sessionSecret,
    demoMode: bool(env.FINO_DEMO_MODE, !production),
    store,
    dataDir,
    dynamoTable,
    awsRegion: text(env.AWS_REGION) ?? text(env.AWS_DEFAULT_REGION),
    bedrockModelId: text(env.FINO_BEDROCK_MODEL_ID),
    snsTopicArn: text(env.FINO_SNS_TOPIC_ARN),
    webhookUrl: text(env.FINO_WEBHOOK_URL),
    guardianSchedule: bool(env.FINO_GUARDIAN_SCHEDULE, true),
    guardianStartDelayMinutes: Math.max(0, Number(env.FINO_GUARDIAN_START_DELAY_MINUTES ?? (bool(env.FINO_DEMO_MODE, !production) ? 10 : 0)) || 0),
    webDist: existsSync(path.join(webDistCandidate, 'index.html')) ? webDistCandidate : null,
    viewsDir,
    production,
    version: '1.0.0',
  };
}
