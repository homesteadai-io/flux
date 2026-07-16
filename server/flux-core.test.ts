import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
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

test('createFolder and moveNote keep the file and frontmatter in sync', (t) => {
  const { core, dataDir } = createTestCore(t);
  const created = core.createTextNote({ title: 'Move me', content: 'Still here.' });

  const folderResult = core.createFolder('Projects');
  assert.equal(folderResult.folder, 'Projects');
  const library = core.moveNote(created.note.id, 'Projects');

  assert.equal(existsSync(path.join(dataDir, 'Inbox', `${created.note.id}.md`)), false);
  const targetPath = path.join(dataDir, 'Projects', `${created.note.id}.md`);
  assert.equal(existsSync(targetPath), true);
  assert.match(readFileSync(targetPath, 'utf8'), /^folder: Projects$/m);
  assert.equal(library.notes.find((note) => note.id === created.note.id)?.folder, 'Projects');
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
  assert.throws(() => core.moveNote('..\\outside', 'Inbox'), /must not contain a path/);
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
