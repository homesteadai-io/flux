import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import { Worker } from 'node:worker_threads';
import { fluxWorkingListItemLimit } from '../shared/flux-contract.js';
import type { FluxCoreOptions } from '../shared/flux-contract.js';
import { FluxCore } from './flux-core.js';

function createTestCore(t: TestContext, options: Omit<FluxCoreOptions, 'dataDir'> = {}) {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'flux-core-test-'));
  t.after(() => rmSync(dataDir, { recursive: true, force: true }));
  return { core: new FluxCore({ ...options, dataDir }), dataDir };
}

test('listLibrary and readNote preserve existing Flux Markdown parsing', (t) => {
  const { core, dataDir } = createTestCore(t);
  const folderPath = path.join(dataDir, 'Inbox');
  mkdirSync(folderPath, { recursive: true });
  const markdown = `---
title: "Existing capture"
source: voice
created: 2026-07-15T14:00:00.000Z
folder: Inbox
analysis_model: test-model
---
# Existing capture
## AI Analysis
This is the useful point.

## Next Steps
- [ ] Keep the original format
- [x] Parse completed syntax too

## Transcript
The complete existing transcript stays intact.
`;
  writeFileSync(path.join(folderPath, 'existing-capture.md'), markdown, 'utf8');

  const library = core.listLibrary();
  assert.deepEqual(library.folders, [{ name: 'Inbox', count: 1 }]);
  assert.equal(library.notes.length, 1);
  assert.deepEqual(library.notes[0].analysis, {
    model: 'test-model',
    topline: 'This is the useful point.',
    nextSteps: ['Keep the original format', 'Parse completed syntax too']
  });
  assert.equal(library.notes[0].transcript, 'The complete existing transcript stays intact.');

  const result = core.readNote({ noteId: 'existing-capture', folder: 'Inbox' });
  assert.equal(result.markdown, markdown);
  assert.equal(result.note.title, 'Existing capture');
  assert.equal('filePath' in result.note, false);
});

test('createTextNote creates unique durable notes and supports folder filters', (t) => {
  const { core, dataDir } = createTestCore(t);
  const first = core.createTextNote({
    title: 'Control room note',
    content: 'First line.\n\nSecond line.'
  });
  const second = core.createTextNote({
    title: 'Control room note',
    content: 'Another complete note.'
  });

  assert.match(first.note.id, /^\d{4}-\d{2}-\d{2}-control-room-note$/);
  assert.equal(second.note.id, `${first.note.id}-2`);
  assert.equal(first.note.source, 'text');
  assert.equal(first.note.folder, 'Inbox');

  const notePath = path.join(dataDir, 'Inbox', `${first.note.id}.md`);
  const markdown = readFileSync(notePath, 'utf8');
  assert.match(markdown, /source: text/);
  assert.match(markdown, /## Transcript\nFirst line\.\n\nSecond line\./);
  assert.deepEqual(core.listLibrary({ source: 'text', folder: 'Inbox' }).notes.length, 2);
});

test('concurrent note creators reserve unique files atomically', async (t) => {
  const { dataDir } = createTestCore(t);
  const workerCount = 8;
  const gate = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT * 2);
  const gateView = new Int32Array(gate);
  const workerCode = `
const { parentPort, workerData } = require('node:worker_threads');
void import('tsx/esm/api').then(({ tsImport }) => tsImport(workerData.moduleUrl, workerData.moduleUrl)).then(({ FluxCore }) => {
  const view = new Int32Array(workerData.gate);
  Atomics.add(view, 0, 1);
  Atomics.notify(view, 0);
  Atomics.wait(view, 1, 0);
  const core = new FluxCore({ dataDir: workerData.dataDir });
  const created = core.createTextNote({
    title: 'Concurrent note',
    content: 'Concurrent content',
    folder: 'Inbox'
  });
  parentPort.postMessage(created.note.id);
});
`;

  const workers: Worker[] = [];
  const completions = Array.from(
    { length: workerCount },
    () =>
      new Promise<string>((resolve, reject) => {
        const worker = new Worker(workerCode, {
          eval: true,
          workerData: {
            dataDir,
            gate,
            moduleUrl: new URL('./flux-core.ts', import.meta.url).href
          }
        });
        workers.push(worker);
        worker.once('message', (noteId: string) => {
          resolve(noteId);
          void worker.terminate();
        });
        worker.once('error', reject);
        worker.once('exit', (code) => {
          if (code !== 0) reject(new Error(`Concurrent note worker exited with ${code}.`));
        });
      })
  );

  const readyDeadline = Date.now() + 5_000;
  while (Atomics.load(gateView, 0) < workerCount) {
    if (Date.now() > readyDeadline) {
      await Promise.all(workers.map((worker) => worker.terminate()));
      throw new Error('Concurrent note workers did not become ready.');
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  Atomics.store(gateView, 1, 1);
  Atomics.notify(gateView, 1, workerCount);

  const noteIds = await Promise.all(completions);
  assert.equal(new Set(noteIds).size, workerCount);
  const files = readdirSync(path.join(dataDir, 'Inbox')).filter((file) => file.endsWith('.md'));
  assert.equal(files.length, workerCount);
  for (const file of files) {
    assert.match(readFileSync(path.join(dataDir, 'Inbox', file), 'utf8'), /Concurrent content/);
  }
});

test('createFolder and moveNote keep the file and frontmatter in sync', (t) => {
  const { core, dataDir } = createTestCore(t);
  const created = core.createTextNote({ title: 'Move me', content: 'Still here.' });

  const folderResult = core.createFolder('Projects');
  assert.equal(folderResult.folder, 'Projects');
  const library = core.moveNote({ noteId: created.note.id, folder: 'Inbox' }, 'Projects');

  assert.equal(existsSync(path.join(dataDir, 'Inbox', `${created.note.id}.md`)), false);
  const targetPath = path.join(dataDir, 'Projects', `${created.note.id}.md`);
  assert.equal(existsSync(targetPath), true);
  assert.match(readFileSync(targetPath, 'utf8'), /^folder: Projects$/m);
  assert.equal(library.notes.find((note) => note.id === created.note.id)?.folder, 'Projects');
});

test('moveNote uses the source folder when note identifiers match', (t) => {
  const { core, dataDir } = createTestCore(t);
  const inbox = core.createTextNote({
    title: 'Duplicate title',
    content: 'Inbox copy.',
    folder: 'Inbox'
  });
  const archive = core.createTextNote({
    title: 'Duplicate title',
    content: 'Archive copy.',
    folder: 'Archive'
  });

  assert.equal(archive.note.id, inbox.note.id);
  core.moveNote({ noteId: archive.note.id, folder: 'Archive' }, 'Projects');

  const inboxPath = path.join(dataDir, 'Inbox', `${inbox.note.id}.md`);
  const archivePath = path.join(dataDir, 'Archive', `${archive.note.id}.md`);
  const projectPath = path.join(dataDir, 'Projects', `${archive.note.id}.md`);
  assert.equal(existsSync(inboxPath), true);
  assert.equal(existsSync(archivePath), false);
  assert.equal(existsSync(projectPath), true);
  assert.match(readFileSync(inboxPath, 'utf8'), /Inbox copy/);
  assert.match(readFileSync(projectPath, 'utf8'), /Archive copy/);
});
test('working list has one persistent JSON-backed value per data directory', (t) => {
  const { core, dataDir } = createTestCore(t);
  assert.deepEqual(core.readWorkingList(), { title: 'Flux list', items: [] });

  const saved = core.saveWorkingList({
    title: 'Today',
    items: ['Review the control room', '  Preserve the full transcript  ', '']
  });
  assert.equal(saved.title, 'Today');
  assert.deepEqual(saved.items, ['Review the control room', 'Preserve the full transcript']);
  assert.match(saved.updatedAt ?? '', /^\d{4}-\d{2}-\d{2}T/);

  const secondInstance = new FluxCore({ dataDir });
  assert.deepEqual(secondInstance.readWorkingList(), saved);
  assert.deepEqual(
    JSON.parse(readFileSync(path.join(dataDir, '.flux', 'working-list.json'), 'utf8')),
    saved
  );
});

test('working list preserves the shared limit and rejects overflow', (t) => {
  const { core } = createTestCore(t);
  const items = Array.from({ length: fluxWorkingListItemLimit }, (_, index) => 'Item ' + index);

  const saved = core.saveWorkingList({ title: 'Maximum list', items });
  assert.equal(saved.items.length, fluxWorkingListItemLimit);
  assert.equal(saved.items.at(-1), 'Item 999');
  assert.throws(
    () => core.saveWorkingList({ title: 'Overflow list', items: [...items, 'Item 1000'] }),
    /cannot exceed 1000 items/
  );
});

test('capture draft persists exact text in one JSON-backed value', (t) => {
  const { core, dataDir } = createTestCore(t);
  assert.deepEqual(core.readCaptureDraft(), { text: '' });

  const draft = { text: '  First thought.\n\nSecond thought stays exact.  ' };
  assert.deepEqual(core.saveCaptureDraft(draft), draft);
  assert.deepEqual(
    JSON.parse(readFileSync(path.join(dataDir, '.flux', 'capture-draft.json'), 'utf8')),
    draft
  );

  const secondInstance = new FluxCore({ dataDir });
  assert.deepEqual(secondInstance.readCaptureDraft(), draft);
});

test('public note operations reject path traversal and do not create outside files', (t) => {
  const { core, dataDir } = createTestCore(t);
  const outsidePath = path.resolve(dataDir, '..', 'outside.md');

  assert.throws(() => core.createFolder('../outside'), /plain visible characters/);
  assert.throws(
    () => core.createTextNote({ title: 'Unsafe', content: 'No.', folder: '..\\outside' }),
    /plain visible characters/
  );
  assert.throws(
    () => core.readNote({ noteId: '../outside', folder: 'Inbox' }),
    /must not contain a path/
  );
  assert.throws(
    () => core.moveNote({ noteId: '..\\outside', folder: 'Inbox' }, 'Projects'),
    /must not contain a path/
  );
  assert.equal(existsSync(outsidePath), false);
});

test('saveYouTubeUrl saves the injected engine full transcript without analysis', async (t) => {
  const fullTranscript = `${'A complete caption sentence. '.repeat(20)}TAIL_MARKER`;
  let requestedUrl = '';
  const { core } = createTestCore(t, {
    transcriptEngine: {
      async getCleanTranscript(url) {
        requestedUrl = url;
        return { ok: true, transcript: fullTranscript };
      }
    }
  });

  const result = await core.saveYouTubeUrl({ url: 'https://youtu.be/example' });
  assert.equal(requestedUrl, 'https://youtu.be/example');
  assert.equal(result.note.transcript, fullTranscript);
  assert.equal(result.note.analysis, undefined);
  assert.equal(
    core.readNote({ noteId: result.note.id, folder: 'Transcript Notes' }).markdown.includes('TAIL_MARKER'),
    true
  );
});

test('saveYouTubeUrl reads heading-like transcript lines through the tail unchanged', async (t) => {
  const fullTranscript = [
    'Opening transcript line.',
    '## Important',
    'This heading belongs to the transcript.',
    '## Follow-up context',
    'This heading also belongs to the transcript.',
    '## AI Analysis',
    'This is transcript text, not note analysis.',
    '## Next Steps',
    '- [ ] This is also transcript text.',
    'TAIL_MARKER'
  ].join('\n');
  const { core } = createTestCore(t, {
    transcriptEngine: {
      async getCleanTranscript() {
        return { ok: true, transcript: fullTranscript };
      }
    }
  });

  const saved = await core.saveYouTubeUrl({ url: 'https://youtu.be/headings' });
  const read = core.readNote({ noteId: saved.note.id, folder: 'Transcript Notes' });

  assert.equal(read.note.transcript, fullTranscript);
  assert.equal(read.note.transcript.endsWith('TAIL_MARKER'), true);
  assert.equal(read.note.analysis, undefined);
});

test('saveYouTubeUrl removes a repeated full transcript block before saving', async (t) => {
  const cleanBody = Array.from({ length: 120 }, (_, index) => `word${index}`).join(' ');
  const { core, dataDir } = createTestCore(t, {
    transcriptEngine: {
      async getCleanTranscript() {
        return { ok: true, transcript: `${cleanBody}\n\n${cleanBody}` };
      }
    }
  });

  const saved = await core.saveYouTubeUrl({ url: 'https://youtu.be/repeated-body' });
  const markdown = readFileSync(path.join(dataDir, 'Transcript Notes', `${saved.note.id}.md`), 'utf8');
  assert.equal(saved.note.transcript, cleanBody);
  assert.equal(saved.note.transcript.split('word0').length - 1, 1);
  assert.equal(markdown.split('word0').length - 1, 1);
  assert.match(markdown, /url: "https:\/\/youtu\.be\/repeated-body"/);
  assert.match(markdown, /created: \d{4}-\d{2}-\d{2}T/);
});

test('duplicate guarding handles very short exact repeats without removing distinct repeated phrases', async (t) => {
  const shortBody = Array.from({ length: 11 }, (_, index) => `short${index}`).join(' ');
  let transcript = `${shortBody}\n\n${shortBody}`;
  const { core } = createTestCore(t, {
    transcriptEngine: {
      async getCleanTranscript() {
        return { ok: true, transcript };
      }
    }
  });

  const repeated = await core.saveYouTubeUrl({ url: 'https://youtu.be/short-repeat' });
  assert.equal(repeated.note.transcript, shortBody);

  transcript = 'echo echo';
  const oneWord = await core.saveYouTubeUrl({ url: 'https://youtu.be/one-word-repeat' });
  assert.equal(oneWord.note.transcript, 'echo');

  transcript = `${shortBody}\n\n${shortBody} final distinct caption words`;
  const distinct = await core.saveYouTubeUrl({ url: 'https://youtu.be/short-distinct' });
  assert.equal(distinct.note.transcript, transcript);
});

test('video handoffs are per-action, durable, task-bound, and preserve raw transcripts', async (t) => {
  const { core, dataDir } = createTestCore(t, {
    transcriptEngine: {
      async getCleanTranscript() {
        return { ok: true, transcript: 'Complete captions for the queued video.' };
      }
    }
  });
  assert.equal(core.readCodexTaskTarget(), null);
  assert.equal(core.readLatestVideoHandoff(), null);
  const target = core.saveCodexTaskTarget('task-123', 'Flux acceptance');
  assert.equal(target.taskId, 'task-123');
  assert.deepEqual(core.saveCodexTaskTarget('task-123', 'Flux acceptance'), target);

  const note = await core.saveYouTubeUrl({ url: 'https://youtu.be/digest-example' });
  const first = core.createVideoHandoff({
    expectedTaskId: 'task-123',
    sourceNote: { noteId: note.note.id, folder: note.note.folder }
  });
  const second = core.createVideoHandoff({
    expectedTaskId: 'task-123',
    sourceNote: { noteId: note.note.id, folder: note.note.folder }
  });

  assert.notEqual(first.handoffId, second.handoffId);
  assert.equal(first.state, 'queued');
  assert.equal(first.sourceUrl, note.note.url);
  assert.equal(first.rawTranscript, note.note.transcript);
  assert.deepEqual(first.sourceNote, {
    noteId: note.note.id,
    folder: note.note.folder,
    title: note.note.title
  });
  assert.equal(first.targetTask.taskId, 'task-123');
  assert.equal(core.listVideoHandoffs('task-123').length, 2);
  core.saveCodexTaskTarget('task-456');
  assert.throws(
    () => core.createVideoHandoff({
      expectedTaskId: 'task-123',
      sourceNote: { noteId: note.note.id, folder: note.note.folder }
    }),
    /connected Codex task changed/
  );
  const reboundTarget = core.saveCodexTaskTarget('task-123', 'Flux acceptance');

  const restarted = new FluxCore({ dataDir });
  assert.deepEqual(restarted.readCodexTaskTarget(), reboundTarget);
  assert.equal(restarted.readLatestVideoHandoff()?.handoffId, second.handoffId);

  const claimed = restarted.claimVideoHandoff({ handoffId: second.handoffId, taskId: 'task-123' });
  assert.equal(claimed.handoffId, second.handoffId);
  assert.equal(claimed.state, 'claimed');
  assert.equal(restarted.claimVideoHandoff({ handoffId: second.handoffId, taskId: 'task-123' }).state, 'claimed');
  assert.throws(
    () => restarted.completeVideoHandoff({
      handoffId: second.handoffId,
      taskId: 'wrong-task',
      analysisResult: 'Should not save.'
    }),
    /different Codex task/
  );

  const completed = restarted.completeVideoHandoff({
    handoffId: second.handoffId,
    taskId: 'task-123',
    analysisResult: 'Grounded downstream analysis.'
  });
  assert.equal(completed.state, 'analysis_ready');
  assert.equal(completed.analysisResult, 'Grounded downstream analysis.');
  assert.equal(completed.rawTranscript, first.rawTranscript);

  const claimedFirst = restarted.claimVideoHandoff({ handoffId: first.handoffId, taskId: 'task-123' });
  const failed = restarted.failVideoHandoff({
    handoffId: claimedFirst.handoffId,
    taskId: 'task-123',
    failureMessage: 'Video frames were unavailable.'
  });
  assert.equal(failed.state, 'failed');
  assert.equal(failed.rawTranscript, first.rawTranscript);
  assert.equal(
    readdirSync(path.join(dataDir, '.flux', 'video-handoffs')).filter((name) => /^[a-f0-9-]{36}\.json$/iu.test(name)).length,
    2
  );
});

test('generated handoffs recover to queued and terminal transitions are first-writer-wins', async (t) => {
  const { core, dataDir } = createTestCore(t, {
    transcriptEngine: {
      async getCleanTranscript() {
        return { ok: true, transcript: 'Short source transcript for lifecycle recovery.' };
      }
    }
  });
  core.saveCodexTaskTarget('task-race');
  const note = await core.saveYouTubeUrl({ url: 'https://youtu.be/lifecycle-race' });
  const queued = core.createVideoHandoff({
    expectedTaskId: 'task-race',
    sourceNote: { noteId: note.note.id, folder: note.note.folder }
  });
  const handoffPath = path.join(dataDir, '.flux', 'video-handoffs', `${queued.handoffId}.json`);
  const stranded = JSON.parse(readFileSync(handoffPath, 'utf8')) as Record<string, unknown>;
  stranded.state = 'generated';
  delete stranded.queuedAt;
  writeFileSync(handoffPath, `${JSON.stringify(stranded, null, 2)}\n`);

  const firstProcess = new FluxCore({ dataDir });
  const recovered = firstProcess.readLatestVideoHandoff('task-race');
  assert.equal(recovered?.handoffId, queued.handoffId);
  assert.equal(recovered?.state, 'queued');
  const handoffDir = path.join(dataDir, '.flux', 'video-handoffs');
  writeFileSync(path.join(handoffDir, `${queued.handoffId}.claim.interrupted.tmp`), 'partial');
  firstProcess.claimVideoHandoff({ handoffId: queued.handoffId, taskId: 'task-race' });
  assert.equal(readFileSync(path.join(handoffDir, `${queued.handoffId}.claim`), 'utf8').trim(), 'task-race');

  const secondProcess = new FluxCore({ dataDir });
  writeFileSync(path.join(handoffDir, `${queued.handoffId}.terminal.interrupted.tmp`), '{');
  const completed = firstProcess.completeVideoHandoff({
    handoffId: queued.handoffId,
    taskId: 'task-race',
    analysisResult: 'The winning terminal result.'
  });
  const competingFailure = secondProcess.failVideoHandoff({
    handoffId: queued.handoffId,
    taskId: 'task-race',
    failureMessage: 'This must not replace the winner.'
  });
  assert.equal(completed.state, 'analysis_ready');
  assert.equal(competingFailure.state, 'analysis_ready');
  assert.equal(competingFailure.analysisResult, 'The winning terminal result.');
  assert.equal(competingFailure.failureMessage, undefined);
  assert.equal(
    JSON.parse(readFileSync(path.join(handoffDir, `${queued.handoffId}.terminal.json`), 'utf8')).state,
    'analysis_ready'
  );
});

test('saveRecording persists audio before injected transcription and analysis', async (t) => {
  const audioBytes = new Uint8Array([1, 2, 3, 4]);
  let observedAudioPath = '';
  const { core, dataDir } = createTestCore(t, {
    aiProviderFactory: () => ({
      async transcribeAudio(audioPath, mimeType) {
        observedAudioPath = audioPath;
        assert.equal(mimeType, 'audio/webm');
        assert.deepEqual(readFileSync(audioPath), Buffer.from(audioBytes));
        return 'Voice transcript in full.';
      },
      async analyzeTranscript(transcript) {
        assert.equal(transcript, 'Voice transcript in full.');
        return {
          title: 'Voice capture',
          model: 'injected-test-model',
          topline: 'A grounded topline.',
          nextSteps: ['Use the shared core']
        };
      }
    })
  });

  const result = await core.saveRecording({ audioData: audioBytes, mimeType: 'audio/webm;codecs=opus' });
  assert.equal(observedAudioPath.startsWith(path.join(dataDir, '.flux', 'audio') + path.sep), true);
  assert.equal(result.note.source, 'voice');
  assert.equal(result.note.transcript, 'Voice transcript in full.');
  assert.deepEqual(result.note.analysis, {
    model: 'injected-test-model',
    topline: 'A grounded topline.',
    nextSteps: ['Use the shared core']
  });
});
