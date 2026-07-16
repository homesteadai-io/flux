import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { startFluxHttpServer } from './http-server.js';

function makeCore() {
  const workingList = { title: 'Test list', items: ['One'] };
  return {
    listLibrary: () => ({ folders: [{ name: 'Inbox', count: 0 }], notes: [] }),
    readNote: ({ noteId, folder }: { noteId: string; folder: string }) => ({ noteId, folder, markdown: '# Note' }),
    createTextNote: (payload: unknown) => ({ payload }),
    saveRecording: async (payload: unknown) => ({ payload }),
    saveYouTubeUrl: async (payload: unknown) => ({ payload }),
    createFolder: (name: string) => ({ folder: name }),
    moveNote: (noteId: string, targetFolder: string) => ({ noteId, targetFolder }),
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
  } finally {
    await host.close();
  }
});
test('validates and saves the shared working list', async () => {
  const staticDir = mkdtempSync(path.join(os.tmpdir(), 'flux-http-'));
  writeFileSync(path.join(staticDir, 'index.html'), '<main>Flux</main>');
  const host = await startFluxHttpServer({ core: makeCore(), staticDir, port: 0 });

  try {
    const response = await fetch(`${host.url}/api/working-list`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Launch', items: ['Build', 'Review'] })
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { title: 'Launch', items: ['Build', 'Review'] });
  } finally {
    await host.close();
  }
});
