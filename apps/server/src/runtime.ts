import path from 'node:path';
import { FinanceService, MemoryRepository, createDemoLedger, type LedgerRepository } from '@finorchestrate/core';
import { BedrockPlanner } from './agent/bedrock.js';
import type { AppConfig } from './config.js';
import { pubSub } from './graphql/schema.js';
import { createNotifier, type Notifier } from './notify.js';
import { DynamoRepository } from './store/dynamo-repository.js';
import { FileRepository } from './store/file-repository.js';

export interface Runtime {
  config: AppConfig;
  service: FinanceService;
  planner: BedrockPlanner | null;
  notifier: Notifier;
  log: (message: string) => void;
}

export function createRepository(config: AppConfig): LedgerRepository {
  switch (config.store) {
    case 'memory':
      return new MemoryRepository();
    case 'dynamodb':
      return new DynamoRepository(config.dynamoTable!, { region: config.awsRegion });
    default:
      return new FileRepository(path.join(config.dataDir, 'ledger.json'));
  }
}

/** Everything long lived, shared by the HTTP server and the scheduled guardian Lambda. */
export async function createRuntime(config: AppConfig, log: (message: string) => void = (message) => console.log(message)): Promise<Runtime> {
  const notifier = createNotifier({ snsTopicArn: config.snsTopicArn, webhookUrl: config.webhookUrl, region: config.awsRegion, log });
  const service = new FinanceService({
    repository: createRepository(config),
    seed: createDemoLedger,
    onChange: (event) => {
      pubSub.publish('ledger', event);
      void notifier.handle(event);
    },
  });
  await service.init();
  const planner = config.bedrockModelId ? new BedrockPlanner(config.bedrockModelId, config.awsRegion) : null;
  return { config, service, planner, notifier, log };
}
