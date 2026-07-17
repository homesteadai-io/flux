import assert from 'node:assert/strict';
import test from 'node:test';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import type {
  FluxCreateTextNotePayload,
  FluxLibrarySnapshot,
  FluxNoteMutationResult,
  FluxReadNoteResult,
  FluxSaveWorkingListPayload,
  FluxSaveYouTubePayload,
  FluxVideoDigestRequest,
  FluxWorkingList,
} from '../shared/flux-contract.js';
import { buildMcpServer, type FluxMcpCore } from './server.js';

const textNote = {
  id: 'note-1',
  title: 'First note',
  source: 'text' as const,
  created: '2026-07-16T12:00:00.000Z',
  folder: 'Inbox',
  transcript: 'Full private note body',
  transcriptPreview: 'Full private note body',
  analysis: { model: 'private-model', topline: 'Private summary', nextSteps: ['Private next step'] },
};

const youtubeNote = {
  id: 'note-2',
  title: 'Video note',
  source: 'youtube' as const,
  created: '2026-07-16T13:00:00.000Z',
  folder: 'Research',
  url: 'https://www.youtube.com/watch?v=abc123',
  transcript: 'Complete native captions',
  transcriptPreview: 'Complete native captions',
  analysis: { model: 'private-model', topline: 'Private video summary', nextSteps: [] },
};

class FakeFluxCore implements FluxMcpCore {
  library: FluxLibrarySnapshot = {
    folders: [
      { name: 'Inbox', count: 1 },
      { name: 'Research', count: 1 },
    ],
    notes: [textNote, youtubeNote],
  };

  workingList: FluxWorkingList = { title: 'Today', items: ['Ship Flux'] };
  videoDigestRequest: FluxVideoDigestRequest = {
    url: 'https://www.youtube.com/watch?v=abc123',
    requestedAt: '2026-07-16T13:30:00.000Z',
    sourceNote: { noteId: 'note-2', folder: 'Research', title: 'Video note' },
  };
  calls: Array<{ method: string; payload?: unknown }> = [];

  listLibrary(): FluxLibrarySnapshot {
    this.calls.push({ method: 'listLibrary' });
    return this.library;
  }

  readNote(payload: { noteId: string; folder: string }): FluxReadNoteResult {
    this.calls.push({ method: 'readNote', payload });
    return { note: textNote, markdown: '# First note\n\nFull private note body' };
  }

  createTextNote(payload: FluxCreateTextNotePayload): FluxNoteMutationResult {
    this.calls.push({ method: 'createTextNote', payload });
    return { note: textNote, library: this.library };
  }

  async saveYouTubeUrl(payload: FluxSaveYouTubePayload): Promise<FluxNoteMutationResult> {
    this.calls.push({ method: 'saveYouTubeUrl', payload });
    return { note: youtubeNote, library: this.library };
  }

  readVideoDigestRequest(): FluxVideoDigestRequest {
    this.calls.push({ method: 'readVideoDigestRequest' });
    return this.videoDigestRequest;
  }

  readWorkingList(): FluxWorkingList {
    this.calls.push({ method: 'readWorkingList' });
    return this.workingList;
  }

  saveWorkingList(payload: FluxSaveWorkingListPayload): FluxWorkingList {
    this.calls.push({ method: 'saveWorkingList', payload });
    this.workingList = { ...payload, updatedAt: '2026-07-16T14:00:00.000Z' };
    return this.workingList;
  }
}

async function connect(core: FluxMcpCore) {
  const server = buildMcpServer(core);
  const client = new Client({ name: 'flux-test', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  return {
    client,
    async close() {
      await Promise.all([client.close(), server.close()]);
    },
  };
}

function structured(result: Awaited<ReturnType<Client['callTool']>>): Record<string, unknown> {
  assert.ok(result.structuredContent);
  return result.structuredContent as Record<string, unknown>;
}

test('registers exactly the seven Phase 7 Flux tools', async () => {
  const connection = await connect(new FakeFluxCore());
  try {
    const listed = await connection.client.listTools();
    assert.deepEqual(
      listed.tools.map((tool) => tool.name).sort(),
      [
        'flux_create_note',
        'flux_fetch_youtube_transcript',
        'flux_list_notes',
        'flux_read_note',
        'flux_read_video_digest_request',
        'flux_read_working_list',
        'flux_save_working_list',
      ],
    );
    const youtubeTool = listed.tools.find((tool) => tool.name === 'flux_fetch_youtube_transcript');
    const localWriteTool = listed.tools.find((tool) => tool.name === 'flux_create_note');
    const digestTool = listed.tools.find((tool) => tool.name === 'flux_read_video_digest_request');
    assert.equal(youtubeTool?.annotations?.openWorldHint, true);
    assert.equal(localWriteTool?.annotations?.openWorldHint, false);
    assert.deepEqual(digestTool?.annotations, {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
  } finally {
    await connection.close();
  }
});

test('routes all seven tools and returns bounded structured payloads', async () => {
  const core = new FakeFluxCore();
  const connection = await connect(core);

  try {
    const listed = await connection.client.callTool({
      name: 'flux_list_notes',
      arguments: { folder: 'Research', source: 'youtube' },
    });
    const listedPayload = structured(listed);
    assert.deepEqual(
      (listedPayload.notes as Array<{ id: string }>).map((note) => note.id),
      ['note-2'],
    );
    const listedNote = (listedPayload.notes as Array<Record<string, unknown>>)[0];
    assert.equal('transcript' in listedNote, false);
    assert.equal('transcriptPreview' in listedNote, false);
    assert.equal('analysis' in listedNote, false);

    const read = await connection.client.callTool({
      name: 'flux_read_note',
      arguments: { noteId: 'note-1', folder: 'Inbox' },
    });
    const readPayload = structured(read);
    assert.equal(readPayload.markdown, '# First note\n\nFull private note body');
    const readMetadata = readPayload.note as Record<string, unknown>;
    assert.equal('transcript' in readMetadata, false);
    assert.equal('transcriptPreview' in readMetadata, false);
    assert.equal('analysis' in readMetadata, false);

    await connection.client.callTool({
      name: 'flux_create_note',
      arguments: { title: 'Captured', content: 'A useful thought', folder: 'Inbox' },
    });
    await connection.client.callTool({
      name: 'flux_fetch_youtube_transcript',
      arguments: { url: 'https://www.youtube.com/watch?v=abc123' },
    });
    const readList = await connection.client.callTool({
      name: 'flux_read_working_list',
      arguments: {},
    });
    assert.deepEqual(structured(readList).workingList, { title: 'Today', items: ['Ship Flux'] });

    const digest = await connection.client.callTool({
      name: 'flux_read_video_digest_request',
      arguments: {},
    });
    assert.deepEqual(structured(digest).request, core.videoDigestRequest);

    const savedList = await connection.client.callTool({
      name: 'flux_save_working_list',
      arguments: { title: 'Tomorrow', items: ['Package Flux', 'Open the control room'] },
    });
    assert.deepEqual(structured(savedList).workingList, {
      title: 'Tomorrow',
      items: ['Package Flux', 'Open the control room'],
      updatedAt: '2026-07-16T14:00:00.000Z',
    });

    assert.deepEqual(
      core.calls.filter((call) => call.payload !== undefined),
      [
        { method: 'readNote', payload: { noteId: 'note-1', folder: 'Inbox' } },
        {
          method: 'createTextNote',
          payload: { title: 'Captured', content: 'A useful thought', folder: 'Inbox' },
        },
        {
          method: 'saveYouTubeUrl',
          payload: { url: 'https://www.youtube.com/watch?v=abc123' },
        },
        {
          method: 'saveWorkingList',
          payload: { title: 'Tomorrow', items: ['Package Flux', 'Open the control room'] },
        },
      ],
    );
    assert.equal(core.calls.some((call) => call.method === 'readVideoDigestRequest'), true);
  } finally {
    await connection.close();
  }
});

test('rejects path-like identifiers and non-YouTube transcript URLs before core access', async () => {
  const core = new FakeFluxCore();
  const connection = await connect(core);

  try {
    const pathResult = await connection.client.callTool({
      name: 'flux_read_note',
      arguments: { noteId: '../settings.json', folder: 'Inbox' },
    });
    const urlResult = await connection.client.callTool({
      name: 'flux_fetch_youtube_transcript',
      arguments: { url: 'https://example.com/watch?v=abc123' },
    });
    const listResult = await connection.client.callTool({
      name: 'flux_save_working_list',
      arguments: {
        title: 'Overflow',
        items: Array.from({ length: 1_001 }, (_, index) => 'Item ' + index),
      },
    });

    assert.equal(pathResult.isError, true);
    assert.equal(urlResult.isError, true);
    assert.equal(listResult.isError, true);
    assert.equal(core.calls.some((call) => call.method === 'readNote'), false);
    assert.equal(core.calls.some((call) => call.method === 'saveYouTubeUrl'), false);
    assert.equal(core.calls.some((call) => call.method === 'saveWorkingList'), false);
  } finally {
    await connection.close();
  }
});

test('returns structured redacted errors when FluxCore fails', async () => {
  const core = new FakeFluxCore();
  core.listLibrary = () => {
    throw new Error('secret path C:\\Users\\Adam\\Flux\\settings.json');
  };
  const connection = await connect(core);

  try {
    const failed = await connection.client.callTool({ name: 'flux_list_notes', arguments: {} });
    const payload = structured(failed);
    assert.equal(failed.isError, true);
    assert.deepEqual(payload, {
      ok: false,
      error: { code: 'LIST_NOTES_FAILED', message: 'Flux could not list notes.' },
    });
    assert.equal(JSON.stringify(failed).includes('settings.json'), false);
  } finally {
    await connection.close();
  }
});
