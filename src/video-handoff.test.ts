import assert from 'node:assert/strict';
import test from 'node:test';

import { handoffForVisibleNote } from './video-handoff.js';

const handoff: FluxVideoHandoff = {
  handoffId: '11111111-1111-4111-8111-111111111111',
  sourceUrl: 'https://youtu.be/source',
  capturedAt: '2026-07-17T12:00:00.000Z',
  createdAt: '2026-07-17T12:01:00.000Z',
  updatedAt: '2026-07-17T12:02:00.000Z',
  state: 'analysis_ready',
  rawTranscript: 'Preserved raw transcript.',
  sourceNote: { noteId: 'video-a', folder: 'Transcript Notes', title: 'Video A' },
  targetTask: { taskId: 'task-a', boundAt: '2026-07-17T12:01:00.000Z' },
  analysisResult: 'Analysis only for video A.'
};

test('shows a handoff only beside its exact visible transcript note', () => {
  assert.equal(
    handoffForVisibleNote(handoff, { id: 'video-a', folder: 'Transcript Notes' }),
    handoff
  );
  assert.equal(
    handoffForVisibleNote(handoff, { id: 'video-b', folder: 'Transcript Notes' }),
    null
  );
  assert.equal(handoffForVisibleNote(handoff, { id: 'video-a', folder: 'Archive' }), null);
  assert.equal(handoffForVisibleNote(handoff, null), null);
});
