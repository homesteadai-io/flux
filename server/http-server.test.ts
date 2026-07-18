import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fluxWorkingListItemLimit } from '../shared/flux-contract.js';
import { startFluxHttpServer } from './http-server.js';

function makeCore() {
  const workingList = { title: 'Test list', items: ['One'] };
  const codexTask = { taskId: 'task-browser', boundAt: '2026-07-17T12:00:00.000Z' };
  let latestHandoff: unknown = null;
  return {
    listLibrary: () => ({ folders: [{ name: 'Inbox', count: 0 }], notes: [] }),
    readNote: ({ noteId, folder }: { noteId: string; folder: string }) => ({ noteId, folder, markdown: '# Note' }),
    createTextNote: (payload: unknown) => ({ payload }),
    saveRecording: async (payload: unknown) => ({ payload }),
    saveYouTubeUrl: async (payload: unknown) => ({ payload }),
    readCodexTaskTarget: () => codexTask,
    readLatestVideoHandoff: (taskId: string) => taskId === codexTask.taskId ? latestHandoff : null,
    createVideoHandoff: (payload: unknown) => {
      latestHandoff = { handoffId: 'handoff-browser', state: 'queued', payload };
      return latestHandoff;
    },
    createFolder: (name: string) => ({ folder: name }),
    moveNote: (locator: { noteId: string; folder: string }, targetFolder: string) => ({ locator, targetFolder }),
    readWorkingList: () => workingList,
    saveWorkingList: (payload: { title: string; items: string[] }) => ({ ...payload })
  };
}

function requestWithHost(url: string, host: string) {
  return new Promise<number>((resolve, reject) => {
    const target = new URL(url);
    const outgoing = request(
      {
        hostname: target.hostname,
        port: target.port,
        path: target.pathname,
        headers: { Host: host }
      },
      (response) => {
        response.resume();
        response.once('end', () => resolve(response.statusCode ?? 0));
      }
    );
    outgoing.once('error', reject);
    outgoing.end();
  });
}

test('serves the built Flux shell and health endpoint on loopback', async () => {
  const staticDir = mkdtempSync(path.join(os.tmpdir(), 'flux-http-'));
  writeFileSync(path.join(staticDir, 'index.html'), '<main>Flux</main>');
  const host = await startFluxHttpServer({ core: makeCore(), staticDir, port: 0 });

  try {
    const page = await fetch(host.url);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Flux/);

    const health = await fetch(`${host.url}/api/health`);
    assert.deepEqual(await health.json(), { ok: true, product: 'Flux' });
  } finally {
    await host.close();
  }
});

test('reads the bound Codex task and creates a browser video handoff', async () => {
  const staticDir = mkdtempSync(path.join(os.tmpdir(), 'flux-http-'));
  writeFileSync(path.join(staticDir, 'index.html'), '<main>Flux</main>');
  const host = await startFluxHttpServer({ core: makeCore(), staticDir, port: 0 });

  try {
    const target = await fetch(`${host.url}/api/codex-task`);
    assert.equal(target.status, 200);
    assert.deepEqual(await target.json(), { taskId: 'task-browser', boundAt: '2026-07-17T12:00:00.000Z' });

    const empty = await fetch(`${host.url}/api/video-handoffs/latest?taskId=task-browser`);
    assert.equal(await empty.json(), null);

    const payload = {
      expectedTaskId: 'task-browser',
      sourceNote: { noteId: 'youtube-note', folder: 'Transcript Notes' }
    };
    const saved = await fetch(`${host.url}/api/video-handoffs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    assert.equal(saved.status, 201);
    assert.deepEqual(await saved.json(), { handoffId: 'handoff-browser', state: 'queued', payload });

    const read = await fetch(`${host.url}/api/video-handoffs/latest?taskId=task-browser`);
    assert.deepEqual(await read.json(), { handoffId: 'handoff-browser', state: 'queued', payload });

    const malformed = await fetch(`${host.url}/api/video-handoffs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourceNote: 'not-a-note' })
    });
    assert.equal(malformed.status, 422);

    const missingTask = await fetch(`${host.url}/api/video-handoffs/latest`);
    assert.equal(missingTask.status, 422);
  } finally {
    await host.close();
  }
});

test('rejects hostile Host headers and unknown API routes', async () => {
  const staticDir = mkdtempSync(path.join(os.tmpdir(), 'flux-http-'));
  writeFileSync(path.join(staticDir, 'index.html'), '<main>Flux</main>');
  const host = await startFluxHttpServer({ core: makeCore(), staticDir, port: 0 });

  try {
    assert.equal(await requestWithHost(`${host.url}/api/health`, 'attacker.example'), 403);

    const missing = await fetch(`${host.url}/api/not-real`);
    assert.equal(missing.status, 404);
  } finally {
    await host.close();
  }
});

test('rejects hostile browser origins on API mutations', async () => {
  const staticDir = mkdtempSync(path.join(os.tmpdir(), 'flux-http-'));
  writeFileSync(path.join(staticDir, 'index.html'), '<main>Flux</main>');
  const host = await startFluxHttpServer({ core: makeCore(), staticDir, port: 0 });

  try {
    const hostileOrigin = await fetch(`${host.url}/api/folders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://attacker.example' },
      body: JSON.stringify({ name: 'Hostile origin' })
    });
    assert.equal(hostileOrigin.status, 403);

    const hostileFetchSite = await fetch(`${host.url}/api/folders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'cross-site' },
      body: JSON.stringify({ name: 'Hostile fetch site' })
    });
    assert.equal(hostileFetchSite.status, 403);
  } finally {
    await host.close();
  }
});

test('rejects simple content types and accepts same-origin JSON mutations', async () => {
  const staticDir = mkdtempSync(path.join(os.tmpdir(), 'flux-http-'));
  writeFileSync(path.join(staticDir, 'index.html'), '<main>Flux</main>');
  const host = await startFluxHttpServer({ core: makeCore(), staticDir, port: 0 });

  try {
    const simpleRequest = await fetch(`${host.url}/api/folders`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ name: 'Simple request' })
    });
    assert.equal(simpleRequest.status, 415);

    const sameOrigin = await fetch(`${host.url}/api/folders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        Origin: host.url,
        'Sec-Fetch-Site': 'same-origin'
      },
      body: JSON.stringify({ name: 'Browser folder' })
    });
    assert.equal(sameOrigin.status, 201);
    assert.deepEqual(await sameOrigin.json(), { folder: 'Browser folder' });
    const moved = await fetch(`${host.url}/api/notes/move`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ noteId: 'same-id', folder: 'Archive', targetFolder: 'Projects' })
    });
    assert.equal(moved.status, 200);
    assert.deepEqual(await moved.json(), {
      locator: { noteId: 'same-id', folder: 'Archive' },
      targetFolder: 'Projects'
    });
  } finally {
    await host.close();
  }
});
test('validates and saves the shared working list', async () => {
  const staticDir = mkdtempSync(path.join(os.tmpdir(), 'flux-http-'));
  writeFileSync(path.join(staticDir, 'index.html'), '<main>Flux</main>');
  const host = await startFluxHttpServer({ core: makeCore(), staticDir, port: 0 });

  try {
    const items = Array.from({ length: fluxWorkingListItemLimit }, (_, index) => 'Item ' + index);
    const response = await fetch(`${host.url}/api/working-list`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Launch', items })
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { title: 'Launch', items });

    const overflow = await fetch(`${host.url}/api/working-list`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Overflow', items: [...items, 'Item 1000'] })
    });
    assert.equal(overflow.status, 422);
  } finally {
    await host.close();
  }
});

test('redacts lower-level paths from unexpected API errors', async () => {
  const staticDir = mkdtempSync(path.join(os.tmpdir(), 'flux-http-'));
  writeFileSync(path.join(staticDir, 'index.html'), '<main>Flux</main>');
  const core = {
    ...makeCore(),
    listLibrary: () => {
      throw new Error('Failed to read C:\\Users\\Adam\\Flux\\.flux\\state.json');
    }
  };
  const host = await startFluxHttpServer({ core, staticDir, port: 0 });

  try {
    const response = await fetch(`${host.url}/api/library`);
    const body = (await response.json()) as { error: string };

    assert.equal(response.status, 422);
    assert.equal(body.error, 'Flux could not complete that request.');
    assert.doesNotMatch(JSON.stringify(body), /Users|state\.json|\\\\/);
  } finally {
    await host.close();
  }
});
