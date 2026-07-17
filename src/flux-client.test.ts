import assert from 'node:assert/strict';
import test from 'node:test';

import { browserLibrary } from './flux-client.js';

test('browser env save reports that the native folder picker is desktop-only', async () => {
  await assert.rejects(
    browserLibrary.saveEnvLocal({ content: 'EXAMPLE=value' }),
    /Save as \.env is available in the Flux desktop app\./
  );
});

test('browser video digest methods use the bounded shared endpoint', async (t) => {
  const originalFetch = globalThis.fetch;
  const request = {
    url: 'https://youtu.be/digest-example',
    requestedAt: '2026-07-17T12:00:00.000Z'
  };
  const calls: Array<{ url: string; method: string; body?: unknown }> = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const method = init?.method || 'GET';
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    calls.push({ url: String(input), method, ...(body === undefined ? {} : { body }) });
    return new Response(JSON.stringify(request), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  }) as typeof fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  assert.deepEqual(await browserLibrary.readVideoDigestRequest(), request);
  assert.deepEqual(
    await browserLibrary.saveVideoDigestRequest({ url: request.url }),
    request
  );
  assert.deepEqual(calls, [
    { url: '/api/video-digest-request', method: 'GET' },
    {
      url: '/api/video-digest-request',
      method: 'PUT',
      body: { url: request.url }
    }
  ]);
});
