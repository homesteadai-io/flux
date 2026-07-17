import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import { FluxCore } from '../server/flux-core.js';
import type {
  FluxNoteSource,
  FluxNoteSummary,
  FluxWorkingList,
} from '../shared/flux-contract.js';

export type FluxMcpCore = Pick<
  FluxCore,
  | 'listLibrary'
  | 'readNote'
  | 'createTextNote'
  | 'saveYouTubeUrl'
  | 'readWorkingList'
  | 'saveWorkingList'
>;

type FluxNoteMetadata = Omit<FluxNoteSummary, 'transcript'>;

const SOURCE_VALUES = ['text', 'voice', 'youtube'] as const satisfies readonly FluxNoteSource[];
const MAX_TITLE_LENGTH = 240;
const MAX_CONTENT_LENGTH = 1_000_000;
const MAX_LIST_ITEMS = 1_000;

const boundedText = (label: string, maximum: number) =>
  z.string().trim().min(1, `${label} is required.`).max(maximum, `${label} is too long.`);

const safeIdentifier = (label: string) =>
  boundedText(label, 240)
    .refine((value) => value !== '.' && value !== '..', `${label} is invalid.`)
    .refine((value) => !/[\\/\0-\x1f]/u.test(value), `${label} must not contain a path.`);

const youtubeUrl = z
  .string()
  .url('A valid YouTube URL is required.')
  .max(2_048, 'The YouTube URL is too long.')
  .refine((value) => {
    const parsed = new URL(value);
    const hostname = parsed.hostname.toLowerCase();
    return (
      parsed.protocol === 'https:' &&
      (hostname === 'youtu.be' || hostname === 'youtube.com' || hostname.endsWith('.youtube.com'))
    );
  }, 'Only HTTPS YouTube URLs are allowed.');

const readOnlyAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

const writeAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
} as const;

const youtubeWriteAnnotations = {
  ...writeAnnotations,
  openWorldHint: true,
} as const;

function noteMetadata(note: FluxNoteSummary): FluxNoteMetadata {
  const { transcript: _transcript, ...metadata } = note;
  return metadata;
}

function result(payload: Record<string, unknown>): CallToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(payload) }],
    structuredContent: payload,
  };
}

function failure(code: string, message: string): CallToolResult {
  const payload = { ok: false, error: { code, message } };
  return {
    ...result(payload),
    isError: true,
  };
}

async function safely(
  code: string,
  message: string,
  operation: () => Promise<CallToolResult>,
): Promise<CallToolResult> {
  try {
    return await operation();
  } catch {
    return failure(code, message);
  }
}

export function buildMcpServer(core: FluxMcpCore): McpServer {
  const server = new McpServer(
    { name: 'flux', version: '1.0.0' },
    {
      instructions:
        'Flux provides bounded access to the local note library and current working list. It cannot delete notes, access arbitrary paths, run commands, or expose secrets.',
    },
  );

  server.registerTool(
    'flux_list_notes',
    {
      title: 'List Flux notes',
      description: 'List Flux note metadata, optionally filtered by folder and source.',
      inputSchema: z
        .object({
          folder: safeIdentifier('Folder').optional(),
          source: z.enum(SOURCE_VALUES).optional(),
        })
        .strict(),
      annotations: readOnlyAnnotations,
    },
    ({ folder, source }) =>
      safely('LIST_NOTES_FAILED', 'Flux could not list notes.', async () => {
        const library = await core.listLibrary();
        const notes = library.notes
          .filter((note) => folder === undefined || note.folder === folder)
          .filter((note) => source === undefined || note.source === source)
          .map(noteMetadata);

        return result({ ok: true, notes });
      }),
  );

  server.registerTool(
    'flux_read_note',
    {
      title: 'Read a Flux note',
      description: 'Read one complete Markdown note using its stable note identifier and folder.',
      inputSchema: z
        .object({
          noteId: safeIdentifier('Note identifier'),
          folder: safeIdentifier('Folder'),
        })
        .strict(),
      annotations: readOnlyAnnotations,
    },
    ({ noteId, folder }) =>
      safely('READ_NOTE_FAILED', 'Flux could not read that note.', async () => {
        const read = await core.readNote({ noteId, folder });
        return result({ ok: true, note: noteMetadata(read.note), markdown: read.markdown });
      }),
  );

  server.registerTool(
    'flux_create_note',
    {
      title: 'Create a Flux note',
      description: 'Save user-provided text as a local Markdown note in Flux.',
      inputSchema: z
        .object({
          title: boundedText('Title', MAX_TITLE_LENGTH),
          content: boundedText('Content', MAX_CONTENT_LENGTH),
          folder: safeIdentifier('Folder').optional(),
        })
        .strict(),
      annotations: writeAnnotations,
    },
    ({ title, content, folder }) =>
      safely('CREATE_NOTE_FAILED', 'Flux could not create the note.', async () => {
        const created = await core.createTextNote({ title, content, folder });
        return result({ ok: true, note: noteMetadata(created.note) });
      }),
  );

  server.registerTool(
    'flux_fetch_youtube_transcript',
    {
      title: 'Fetch a YouTube transcript',
      description: 'Fetch native YouTube captions and save the complete transcript as a Flux note.',
      inputSchema: z.object({ url: youtubeUrl }).strict(),
      annotations: youtubeWriteAnnotations,
    },
    ({ url }) =>
      safely('YOUTUBE_TRANSCRIPT_FAILED', 'Flux could not fetch that YouTube transcript.', async () => {
        const created = await core.saveYouTubeUrl({ url });
        return result({ ok: true, note: noteMetadata(created.note) });
      }),
  );

  server.registerTool(
    'flux_read_working_list',
    {
      title: 'Read the Flux working list',
      description: 'Read the one current Flux working list.',
      inputSchema: z.object({}).strict(),
      annotations: readOnlyAnnotations,
    },
    () =>
      safely('READ_WORKING_LIST_FAILED', 'Flux could not read the working list.', async () => {
        const workingList = await core.readWorkingList();
        return result({ ok: true, workingList });
      }),
  );

  server.registerTool(
    'flux_save_working_list',
    {
      title: 'Save the Flux working list',
      description: 'Replace the current Flux working list with an explicit title and items.',
      inputSchema: z
        .object({
          title: boundedText('Title', MAX_TITLE_LENGTH),
          items: z
            .array(boundedText('Working-list item', 10_000))
            .max(MAX_LIST_ITEMS, 'The working list has too many items.'),
        })
        .strict(),
      annotations: {
        ...writeAnnotations,
        destructiveHint: true,
        idempotentHint: true,
      },
    },
    ({ title, items }) =>
      safely('SAVE_WORKING_LIST_FAILED', 'Flux could not save the working list.', async () => {
        await core.saveWorkingList({ title, items });
        const workingList: FluxWorkingList = await core.readWorkingList();
        return result({ ok: true, workingList });
      }),
  );

  return server;
}

export async function main(): Promise<void> {
  const dataDir = process.env.FLUX_DATA_DIR?.trim();
  const core = new FluxCore(dataDir ? { dataDir } : {});
  const server = buildMcpServer(core);
  await server.connect(new StdioServerTransport());
}

const invokedPath = process.argv[1];
const isDirectRun = invokedPath !== undefined && pathToFileURL(resolve(invokedPath)).href === import.meta.url;

if (isDirectRun) {
  main().catch(() => {
    process.stderr.write('Flux MCP server failed to start.\n');
    process.exitCode = 1;
  });
}
