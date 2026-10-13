import { createServer } from 'node:http';
import { createHttpApp } from './app.js';
import { loadConfig, loadEnvFile } from './config.js';
import { createRuntime } from './runtime.js';
import { GuardianScheduler } from './scheduler.js';

const log = (message: string) => console.log(`[finorchestrate] ${message}`);

async function main(): Promise<void> {
  loadEnvFile();
  const config = loadConfig();
  const runtime = await createRuntime(config, log);
  const scheduler = config.guardianSchedule ? new GuardianScheduler(runtime.service, log, config.guardianStartDelayMinutes) : null;
  const app = await createHttpApp(runtime, { nextSweepAt: () => scheduler?.nextSweepAt() ?? null });

  const server = createServer((req, res) => void app.handle(req, res));
  server.requestTimeout = 120_000;
  server.headersTimeout = 30_000;
  server.listen(config.port, config.host, () => {
    const local = `http://${config.host === '0.0.0.0' ? 'localhost' : config.host}:${config.port}`;
    log(`listening on ${local}`);
    log(`MCP endpoint (Streamable HTTP, ${['2025-11-25', '2026-07-28'].join(' and ')}): ${app.connection.mcpUrl}`);
    log(`store: ${config.store}${config.store === 'file' ? ` (${config.dataDir})` : ''}, demo mode: ${config.demoMode ? 'on' : 'off'}`);
    log(`planner: ${runtime.planner ? `Amazon Bedrock ${runtime.planner.modelId}` : 'local intent engine'}`);
    if (config.apiTokenSource === 'generated') log(`API token for MCP clients: ${config.apiToken}  (stored in ${config.dataDir}/secrets.json)`);
    if (!config.webDist) log('dashboard build not found; run npm run build, or use npm run dev for the live UI on port 5173');
    scheduler?.start();
  });

  const shutdown = async (signal: string) => {
    log(`${signal} received, shutting down`);
    scheduler?.stop();
    server.close();
    await app.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((error: unknown) => {
  console.error(`[finorchestrate] failed to start: ${(error as Error).message}`);
  process.exit(1);
});
