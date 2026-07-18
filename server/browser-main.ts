import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { FluxCore } from './flux-core.js';
import { startFluxHttpServer } from './http-server.js';

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.FLUX_DATA_DIR?.trim();
const core = new FluxCore(dataDir ? { dataDir } : {});
const codexTaskId = process.env.CODEX_THREAD_ID?.trim();
if (codexTaskId) {
  core.saveCodexTaskTarget(codexTaskId, process.env.CODEX_THREAD_TITLE?.trim());
}

const host = await startFluxHttpServer({
  core,
  staticDir: path.resolve(moduleDirectory, '../../dist')
});

process.stdout.write(`Flux browser is ready at ${host.url}\n`);

let closing = false;
const close = async () => {
  if (closing) {
    return;
  }
  closing = true;
  await host.close();
};

process.once('SIGINT', () => void close().finally(() => process.exit(0)));
process.once('SIGTERM', () => void close().finally(() => process.exit(0)));
