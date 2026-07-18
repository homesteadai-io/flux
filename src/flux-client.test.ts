import assert from 'node:assert/strict';
import test from 'node:test';

import { browserLibrary } from './flux-client.js';

test('browser env save reports that the native folder picker is desktop-only', async () => {
  await assert.rejects(
    browserLibrary.saveEnvLocal({ content: 'EXAMPLE=value' }),
    /Save as \.env is available in the Flux desktop app\./
  );
});

test('browser Codex handoff methods use the bounded shared endpoints', async (t) => {
  const originalFetch = globalThis.fetch;
  const target = {
    taskId: 'task-browser',
    boundAt: '2026-07-17T12:00:00.000Z'
  };
  const handoff = {
    handoffId: 'handoff-browser',
    state: 'queued'
  };
  const calls: Array<{ url: string; method: string; body?: unknown }> = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const method = init?.method || 'GET';
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    calls.push({ url: String(input), method, ...(body === undefined ? {} : { body }) });
    const response = String(input).endsWith('/codex-task') ? target : handoff;
    return new Response(JSON.stringify(response), {
      status: method === 'POST' ? 201 : 200,
      headers: { 'Content-Type': 'application/json' }
    });
  }) as typeof fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  assert.deepEqual(await browserLibrary.readCodexTaskTarget(), target);
  assert.deepEqual(await browserLibrary.readLatestVideoHandoff('task-browser'), handoff);
  assert.deepEqual(
    await browserLibrary.createVideoHandoff({
      expectedTaskId: 'task-browser',
      sourceNote: { noteId: 'youtube-note', folder: 'Transcript Notes' }
    }),
    handoff
  );
  assert.deepEqual(calls, [
    { url: '/api/codex-task', method: 'GET' },
    { url: '/api/video-handoffs/latest?taskId=task-browser', method: 'GET' },
    {
      url: '/api/video-handoffs',
      method: 'POST',
      body: {
        expectedTaskId: 'task-browser',
        sourceNote: { noteId: 'youtube-note', folder: 'Transcript Notes' }
      }
    }
  ]);
});
