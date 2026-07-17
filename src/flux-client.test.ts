import assert from 'node:assert/strict';
import test from 'node:test';

import { browserLibrary } from './flux-client.js';

test('browser env save reports that the native folder picker is desktop-only', async () => {
  await assert.rejects(
    browserLibrary.saveEnvLocal({ content: 'EXAMPLE=value' }),
    /Save as \.env is available in the Flux desktop app\./
  );
});
