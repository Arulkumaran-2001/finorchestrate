// Restores the demo ledger: removes the local ledger file so the next start reseeds it.
// The API token in data/secrets.json is kept, so connected MCP clients keep working.
import { rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = path.join(root, process.env.FINO_DATA_DIR ?? 'data', 'ledger.json');
rmSync(file, { force: true });
console.log(`Removed ${file}. Start the server to reseed the demo ledger, or use Reset demo data on the Connect page while it runs.`);
