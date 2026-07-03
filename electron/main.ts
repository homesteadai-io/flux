import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  IpcMainInvokeEvent,
  screen,
  session,
  shell
} from 'electron';
import OpenAI, { toFile } from 'openai';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import {
  existsSync,
  copyFileSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync
} from 'node:fs';
import os from 'node:os';

type WindowBounds = {
  width: number;
  height: number;
  x?: number;
  y?: number;
};

type FluxSettings = {
  windowBounds?: WindowBounds;
  dataDir?: string;
  lastEnvDirectory?: string;
  transcriptionModelId?: string;
  analysisModelId?: string;
};

type FluxFolder = {
  name: string;
  count: number;
};

type FluxAnalysis = {
  model: string;
  topline: string;
  nextSteps: string[];
};

type FluxNoteSummary = {
  id: string;
  title: string;
  source: 'voice' | 'youtube';
  created: string;
  folder: string;
  url?: string;
  analysis?: FluxAnalysis;
  transcriptPreview: string;
};

type FluxNoteRecord = FluxNoteSummary & {
  path: string;
};

type FluxChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  created: string;
};

type FluxLibrarySnapshot = {
  folders: FluxFolder[];
  notes: FluxNoteSummary[];
};

type SaveRecordingPayload = {
  audioData: unknown;
  mimeType: unknown;
};

type SaveYouTubePayload = {
  url: unknown;
};

type SaveEnvPayload = {
  content: unknown;
};

type SaveEnvResult =
  | { canceled: true }
  | { canceled: false; filePath: string; directory: string; overwritten: boolean };

type CopyMarkdownPayload = {
  noteId: unknown;
  folder: unknown;
};

type MoveNotePayload = {
  noteId: unknown;
  sourceFolder: unknown;
  targetFolder: unknown;
};

type NoteChatPayload = CopyMarkdownPayload & {
  message?: unknown;
};

type CopyMarkdownResult = {
  noteId: string;
  bytes: number;
};

type ExportMarkdownResult =
  | { canceled: true }
  | { canceled: false; filePath: string; directory: string; overwritten: boolean };

type AIProvider = {
  transcribeAudio: (audioPath: string, mimeType: string) => Promise<string>;
  analyzeTranscript: (transcript: string) => Promise<FluxAnalysis & { title: string }>;
  chatWithNote: (noteMarkdown: string, history: FluxChatMessage[], message: string) => Promise<string>;
};

type TranscriptEngineResult =
  | { ok: true; transcript: string }
  | { ok: false; reason: string; message: string; detail?: string };

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const transcriptEngine = require(path.join(__dirname, '../scripts/transcript.cjs')) as {
  getCleanTranscript: (url: string) => Promise<TranscriptEngineResult>;
};
const defaultBounds: WindowBounds = { width: 980, height: 660 };
const defaultDataDir = path.join(os.homedir(), 'Flux');
const defaultMarkdownExportDir = path.join(
  os.homedir(),
  'OneDrive',
  'Desktop',
  'Flux Cowork',
  'Saved Flux Notes'
);
const settingsDir = path.join(defaultDataDir, '.flux');
const settingsPath = path.join(settingsDir, 'settings.json');
const maxChatNoteBytes = 400 * 1024;
const allowedLocalEnvKeys = new Set([
  'OPENAI_API_KEY',
  'OPENAI_TRANSCRIPTION_MODEL',
  'OPENAI_ANALYSIS_MODEL'
]);
const allowedAudioMimeTypes = new Set(['audio/webm', 'audio/mp4', 'audio/ogg', 'audio/wav']);
const maxAudioBytes = 25 * 1024 * 1024;

function readSettings(): FluxSettings {
  try {
    return JSON.parse(readFileSync(settingsPath, 'utf8')) as FluxSettings;
  } catch {
    return {};
  }
}

function writeSettings(settings: FluxSettings) {
  mkdirSync(settingsDir, { recursive: true });
  writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);
}

function loadLocalEnv() {
  const envPath = path.join(app.getAppPath(), '.env.local');
  if (!existsSync(envPath)) {
    return;
  }

  const lines = readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const separator = trimmed.indexOf('=');
    if (separator === -1) {
      continue;
    }

    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim().replace(/^['"]|['"]$/g, '');
    if (allowedLocalEnvKeys.has(key) && value && !process.env[key]) {
      process.env[key] = value;
    }
  }
}

function isTrustedRendererUrl(url: string) {
  if (!url) {
    return false;
  }

  if (url.startsWith('file://')) {
    return true;
  }

  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === 'http:' &&
      (parsed.hostname === '127.0.0.1' ||
        parsed.hostname === 'localhost' ||
        parsed.hostname === '[::1]')
    );
  } catch {
    return false;
  }
}

function getTrustedDevServerUrl() {
  const devUrl = process.env.VITE_DEV_SERVER_URL;
  return devUrl && isTrustedRendererUrl(devUrl) ? devUrl : undefined;
}

function assertTrustedSender(event: IpcMainInvokeEvent) {
  const topLevelUrl = event.sender.getURL();
  const frameUrl = event.senderFrame?.url ?? '';

  if (!isTrustedRendererUrl(topLevelUrl) || (frameUrl && !isTrustedRendererUrl(frameUrl))) {
    throw new Error('Blocked Flux IPC from an untrusted renderer.');
  }
}

function getDataDir() {
  return readSettings().dataDir ?? defaultDataDir;
}

function ensureLibrary() {
  const dataDir = getDataDir();
  mkdirSync(path.join(dataDir, 'Inbox'), { recursive: true });
  mkdirSync(path.join(dataDir, '.flux', 'audio'), { recursive: true });
  return dataDir;
}

function sanitizeFolderName(name: string) {
  const cleaned = name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '').trim();
  if (!cleaned || cleaned.startsWith('.')) {
    throw new Error('Folder name needs plain visible characters.');
  }
  return cleaned.slice(0, 64);
}

function slugify(input: string) {
  const slug = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return slug || 'voice-note';
}

function escapeFrontmatterValue(value: string) {
  return value.replace(/"/g, '\\"');
}

function getMarkdownFiles(folderPath: string) {
  return readdirSync(folderPath)
    .filter((name) => name.toLowerCase().endsWith('.md'))
    .sort((a, b) => {
      const aTime = statSync(path.join(folderPath, a)).mtimeMs;
      const bTime = statSync(path.join(folderPath, b)).mtimeMs;
      return bTime - aTime;
    });
}

function parseFrontmatter(markdown: string) {
  const frontmatter = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const data: Record<string, string> = {};
  if (!frontmatter) {
    return data;
  }

  for (const line of frontmatter[1].split(/\r?\n/)) {
    const separator = line.indexOf(':');
    if (separator === -1) {
      continue;
    }

    const key = line.slice(0, separator).trim();
    const value = line
      .slice(separator + 1)
      .trim()
      .replace(/^['"]|['"]$/g, '')
      .replace(/\\"/g, '"');
    data[key] = value;
  }
  return data;
}

function extractSection(markdown: string, heading: string) {
  const lines = markdown.split(/\r?\n/);
  const startIndex = lines.findIndex((line) => line.trim() === `## ${heading}`);
  if (startIndex === -1) {
    return '';
  }

  const sectionLines: string[] = [];
  for (let index = startIndex + 1; index < lines.length; index += 1) {
    if (lines[index].startsWith('## ')) {
      break;
    }
    sectionLines.push(lines[index]);
  }
  return sectionLines.join('\n').trim();
}

function extractTranscript(markdown: string) {
  const transcript = extractSection(markdown, 'Transcript');
  return transcript.replace(/\s+/g, ' ').slice(0, 180);
}

function extractListItems(section: string) {
  return section
    .split(/\r?\n/)
    .map((line) => line.replace(/^[-*]\s+(?:\[[ xX]\]\s+)?/, '').trim())
    .filter(Boolean);
}

function extractAnalysis(markdown: string, meta: Record<string, string>): FluxAnalysis | undefined {
  const topline = extractSection(markdown, 'AI Analysis');
  const nextSteps = extractListItems(extractSection(markdown, 'Next Steps'));

  if (!topline && nextSteps.length === 0) {
    return undefined;
  }

  return {
    model: meta.analysis_model || 'unknown',
    topline,
    nextSteps
  };
}

function toPublicNote(note: FluxNoteRecord): FluxNoteSummary {
  const { path: _path, ...publicNote } = note;
  return publicNote;
}

function listNoteRecords(dataDir = ensureLibrary()): FluxNoteRecord[] {
  const folders = readdirSync(dataDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => entry.name)
    .sort((a, b) => (a === 'Inbox' ? -1 : b === 'Inbox' ? 1 : a.localeCompare(b)));

  const notes: FluxNoteRecord[] = [];

  for (const folder of folders) {
    const folderPath = path.join(dataDir, folder);
    const markdownFiles = getMarkdownFiles(folderPath);
    for (const file of markdownFiles) {
      const notePath = path.join(folderPath, file);
      const markdown = readFileSync(notePath, 'utf8');
      const meta = parseFrontmatter(markdown);
      const fallbackTitle = file.replace(/\.md$/i, '').replace(/-/g, ' ');
      notes.push({
        id: file.replace(/\.md$/i, ''),
        title: meta.title || fallbackTitle,
        source: meta.source === 'youtube' ? 'youtube' : 'voice',
        created: meta.created || statSync(notePath).mtime.toISOString(),
        folder,
        url: meta.url,
        analysis: extractAnalysis(markdown, meta),
        transcriptPreview: extractTranscript(markdown),
        path: notePath
      });
    }
  }

  notes.sort((a, b) => Date.parse(b.created) - Date.parse(a.created));
  return notes;
}

function listLibrary(): FluxLibrarySnapshot {
  const dataDir = ensureLibrary();
  const folders = readdirSync(dataDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => entry.name)
    .sort((a, b) => (a === 'Inbox' ? -1 : b === 'Inbox' ? 1 : a.localeCompare(b)));

  const folderSummaries = folders.map((folder) => ({
    name: folder,
    count: getMarkdownFiles(path.join(dataDir, folder)).length
  }));

  return {
    folders: folderSummaries,
    notes: listNoteRecords(dataDir).map(toPublicNote)
  };
}

function findNoteRecord(noteId: unknown, folder: unknown) {
  if (typeof noteId !== 'string' || !noteId.trim()) {
    throw new Error('Choose a note first.');
  }

  if (typeof folder !== 'string' || !folder.trim()) {
    throw new Error('Choose a note folder first.');
  }

  const normalizedFolder = sanitizeFolderName(folder);
  const note = listNoteRecords().find(
    (record) => record.id === noteId.trim() && record.folder === normalizedFolder
  );

  if (!note) {
    throw new Error(`Could not find ${noteId}.md in ${normalizedFolder}.`);
  }

  return note;
}

function sanitizeSidecarFileName(value: string) {
  const cleaned = value.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '').trim();
  if (!cleaned || cleaned.startsWith('.')) {
    throw new Error('Note sidecar name needs plain visible characters.');
  }
  return cleaned.slice(0, 96);
}

function getChatSidecarPath(note: FluxNoteRecord, folder = note.folder) {
  const dataDir = ensureLibrary();
  const chatDir = path.join(dataDir, '.flux', 'chat', sanitizeFolderName(folder));
  mkdirSync(chatDir, { recursive: true });
  return path.join(chatDir, `${sanitizeSidecarFileName(note.id)}.json`);
}

function normalizeChatMessages(value: unknown): FluxChatMessage[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((message): message is FluxChatMessage => {
      if (!message || typeof message !== 'object') {
        return false;
      }
      const candidate = message as Record<string, unknown>;
      return (
        typeof candidate.id === 'string' &&
        (candidate.role === 'user' || candidate.role === 'assistant') &&
        typeof candidate.content === 'string' &&
        typeof candidate.created === 'string'
      );
    })
    .map((message) => ({
      id: message.id,
      role: message.role,
      content: message.content.slice(0, 6000),
      created: message.created
    }));
}

function readChatHistory(note: FluxNoteRecord) {
  const chatPath = getChatSidecarPath(note);
  if (!existsSync(chatPath)) {
    return [];
  }

  try {
    const raw = JSON.parse(readFileSync(chatPath, 'utf8')) as { messages?: unknown };
    return normalizeChatMessages(raw.messages);
  } catch {
    const corruptPath = `${chatPath}.corrupt-${Date.now()}.json`;
    renameSync(chatPath, corruptPath);
    throw new Error(`Could not read chat history. Backed up the corrupt sidecar to ${path.basename(corruptPath)}.`);
  }
}

function writeChatHistory(note: FluxNoteRecord, messages: FluxChatMessage[]) {
  const chatPath = getChatSidecarPath(note);
  writeFileSync(chatPath, `${JSON.stringify({ messages }, null, 2)}\n`);
}

function moveChatSidecar(note: FluxNoteRecord, targetFolder: string) {
  const currentPath = getChatSidecarPath(note);
  if (!existsSync(currentPath)) {
    return;
  }

  const nextPath = getChatSidecarPath(note, targetFolder);
  if (path.normalize(currentPath) === path.normalize(nextPath)) {
    return;
  }

  if (existsSync(nextPath)) {
    throw new Error(`Chat history for ${note.id}.md already exists in ${targetFolder}.`);
  }

  renameSync(currentPath, nextPath);
}

function formatDateSlug(date: Date) {
  return date.toISOString().slice(0, 10);
}

function normalizeYouTubeUrl(value: unknown) {
  const input = String(value || '').trim();
  if (!input) {
    throw new Error('Paste a YouTube URL first.');
  }

  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    throw new Error(`That is not a valid YouTube URL: ${input}`);
  }

  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  const isYouTubeHost =
    host === 'youtube.com' ||
    host === 'm.youtube.com' ||
    host === 'music.youtube.com' ||
    host === 'youtu.be';

  if (!isYouTubeHost) {
    throw new Error(`That is not a YouTube URL: ${input}`);
  }

  return parsed.toString();
}

function buildTitle(transcript: string) {
  const words = transcript.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  if (words.length === 0) {
    return 'Untitled voice note';
  }

  const title = words.slice(0, 8).join(' ');
  return title.length > 72 ? `${title.slice(0, 69)}...` : title;
}

function getTranscriptionModelId() {
  return readSettings().transcriptionModelId ?? process.env.OPENAI_TRANSCRIPTION_MODEL;
}

function getAnalysisModelId() {
  return readSettings().analysisModelId ?? process.env.OPENAI_ANALYSIS_MODEL;
}

function stripJsonFences(value: string) {
  return value.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
}

function normalizeBreakdown(rawValue: unknown, model: string, transcript: string) {
  if (!rawValue || typeof rawValue !== 'object') {
    throw new Error('OpenAI returned an invalid analysis payload.');
  }

  const raw = rawValue as Record<string, unknown>;
  const title = typeof raw.title === 'string' ? raw.title.trim() : '';
  const topline = typeof raw.topline === 'string' ? raw.topline.trim() : '';
  const nextSteps = Array.isArray(raw.next_steps)
    ? raw.next_steps
        .filter((step): step is string => typeof step === 'string')
        .map((step) => step.trim())
        .filter(Boolean)
    : [];

  if (!topline) {
    throw new Error('OpenAI analysis was missing a topline.');
  }

  return {
    model,
    title: title || buildTitle(transcript),
    topline,
    nextSteps: nextSteps.slice(0, 6)
  };
}

function createOpenAIProvider(): AIProvider {
  const apiKey = process.env.OPENAI_API_KEY;
  const transcriptionModel = getTranscriptionModelId();
  const analysisModel = getAnalysisModelId();

  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is missing. Add it to .env.local and restart Flux.');
  }

  if (!transcriptionModel) {
    throw new Error('OPENAI_TRANSCRIPTION_MODEL is missing. Add it to .env.local and restart Flux.');
  }

  if (!analysisModel) {
    throw new Error('OPENAI_ANALYSIS_MODEL is missing. Add it to .env.local and restart Flux.');
  }

  const client = new OpenAI({ apiKey });

  return {
    async transcribeAudio(audioPath: string, mimeType: string) {
      const audioBuffer = readFileSync(audioPath);
      const audioFile = await toFile(audioBuffer, path.basename(audioPath), { type: mimeType });
      const response = await client.audio.transcriptions.create({
        file: audioFile,
        model: transcriptionModel
      });

      const transcript = response.text?.trim();
      if (!transcript) {
        throw new Error('OpenAI returned an empty transcript.');
      }
      return transcript;
    },
    async analyzeTranscript(transcript: string) {
      const response = await client.responses.create({
        model: analysisModel,
        instructions:
          'You turn captured transcripts into concise operator notes. Return only grounded facts from the transcript. Do not invent actions, dates, or details that are not supported.',
        input: `Transcript:\n${transcript}`,
        text: {
          format: {
            type: 'json_schema',
            name: 'flux_breakdown',
            strict: true,
            schema: {
              type: 'object',
              additionalProperties: false,
              required: ['title', 'topline', 'next_steps'],
              properties: {
                title: {
                  type: 'string',
                  description: 'A short note title grounded in the transcript.'
                },
                topline: {
                  type: 'string',
                  description: 'Two or three sentences explaining the useful point of the transcript.'
                },
                next_steps: {
                  type: 'array',
                  maxItems: 6,
                  items: { type: 'string' },
                  description:
                    'Concrete next actions explicitly implied by the transcript. Use an empty array if none exist.'
                }
              }
            }
          }
        }
      });

      const text = stripJsonFences(response.output_text ?? '');
      if (!text) {
        throw new Error('OpenAI returned an empty analysis.');
      }

      return normalizeBreakdown(JSON.parse(text), analysisModel, transcript);
    },
    async chatWithNote(noteMarkdown: string, history: FluxChatMessage[], message: string) {
      const historyText = history
        .slice(-12)
        .map((entry) => `${entry.role === 'user' ? 'User' : 'Flux'}: ${entry.content}`)
        .join('\n\n');
      const response = await client.responses.create({
        model: analysisModel,
        instructions:
          'You are Flux note chat. Answer only from the provided note markdown and chat history. If the note does not support an answer, say what is missing. Be concise and practical.',
        input: `NOTE MARKDOWN:\n${noteMarkdown}\n\nCHAT HISTORY:\n${historyText || '(none)'}\n\nUSER QUESTION:\n${message}`
      });

      const answer = response.output_text?.trim();
      if (!answer) {
        throw new Error('OpenAI returned an empty chat answer.');
      }
      return answer;
    }
  };
}

function audioExtension(mimeType: string) {
  if (mimeType.includes('mp4')) {
    return 'mp4';
  }
  if (mimeType.includes('ogg')) {
    return 'ogg';
  }
  if (mimeType.includes('wav')) {
    return 'wav';
  }
  return 'webm';
}

function createMarkdownNote(note: FluxNoteSummary, transcript: string) {
  const analysis = note.analysis;
  const analysisModel = analysis ? `analysis_model: ${analysis.model}\n` : '';
  const urlLine = note.url ? `url: "${escapeFrontmatterValue(note.url)}"\n` : '';
  const analysisSection = analysis
    ? `## AI Analysis
${analysis.topline.trim()}

## Next Steps
${analysis.nextSteps.length ? analysis.nextSteps.map((step) => `- [ ] ${step}`).join('\n') : '- [ ] No explicit next steps captured.'}

`
    : '';

  return `---
title: "${escapeFrontmatterValue(note.title)}"
source: ${note.source}
created: ${note.created}
folder: ${note.folder}
${urlLine}
${analysisModel}---
# ${note.title}
${analysisSection}## Transcript
${transcript.trim()}
`;
}

async function writeAnalyzedNote({
  source,
  transcriptForAnalysis,
  transcriptForMarkdown,
  url
}: {
  source: 'voice' | 'youtube';
  transcriptForAnalysis: string;
  transcriptForMarkdown: string;
  url?: string;
}) {
  const dataDir = ensureLibrary();
  const created = new Date();
  const provider = createOpenAIProvider();
  const breakdown = await provider.analyzeTranscript(transcriptForAnalysis);
  const { title, ...analysis } = breakdown;
  const { noteId, notePath } = uniqueMarkdownPath(
    path.join(dataDir, 'Inbox'),
    `${formatDateSlug(created)}-${slugify(title)}`
  );
  const note: FluxNoteSummary = {
    id: noteId,
    title,
    source,
    created: created.toISOString(),
    folder: 'Inbox',
    url,
    analysis,
    transcriptPreview: transcriptForMarkdown.replace(/\s+/g, ' ').slice(0, 180)
  };
  writeFileSync(notePath, createMarkdownNote(note, transcriptForMarkdown));

  return { note, library: listLibrary() };
}

function uniqueMarkdownPath(folderPath: string, baseNoteId: string) {
  let noteId = baseNoteId;
  let notePath = path.join(folderPath, `${noteId}.md`);
  let suffix = 2;

  while (existsSync(notePath)) {
    noteId = `${baseNoteId}-${suffix}`;
    notePath = path.join(folderPath, `${noteId}.md`);
    suffix += 1;
  }

  return { noteId, notePath };
}

function normalizeMimeType(mimeType: unknown) {
  const baseMimeType = String(mimeType || 'audio/webm')
    .split(';')[0]
    .trim()
    .toLowerCase();

  if (!allowedAudioMimeTypes.has(baseMimeType)) {
    throw new Error(`Unsupported audio format: ${baseMimeType || 'unknown'}.`);
  }
  return baseMimeType;
}

function validateRecordingPayload(payload: SaveRecordingPayload) {
  const mimeType = normalizeMimeType(payload.mimeType);
  let audioData: Uint8Array;

  if (payload.audioData instanceof ArrayBuffer) {
    audioData = new Uint8Array(payload.audioData);
  } else if (ArrayBuffer.isView(payload.audioData)) {
    audioData = new Uint8Array(
      payload.audioData.buffer,
      payload.audioData.byteOffset,
      payload.audioData.byteLength
    );
  } else {
    throw new Error('Recording payload was not valid audio bytes.');
  }

  if (audioData.byteLength === 0) {
    throw new Error('Recording was empty.');
  }

  if (audioData.byteLength > maxAudioBytes) {
    throw new Error('Recording is too large for v0. Keep clips under about 25 MB.');
  }

  return { audioBuffer: Buffer.from(audioData), mimeType };
}

async function saveRecording(payload: SaveRecordingPayload) {
  const dataDir = ensureLibrary();
  const { audioBuffer, mimeType } = validateRecordingPayload(payload);
  const created = new Date();
  const audioId = `${formatDateSlug(created)}-${created.getTime()}`;
  const audioDir = path.join(dataDir, '.flux', 'audio', audioId);
  mkdirSync(audioDir, { recursive: true });

  const audioPath = path.join(audioDir, `recording.${audioExtension(mimeType)}`);
  writeFileSync(audioPath, audioBuffer);

  const provider = createOpenAIProvider();
  const transcript = await provider.transcribeAudio(audioPath, mimeType);
  return writeAnalyzedNote({
    source: 'voice',
    transcriptForAnalysis: transcript,
    transcriptForMarkdown: transcript
  });
}

async function saveYouTubeUrl(payload: SaveYouTubePayload) {
  const url = normalizeYouTubeUrl(payload.url);
  const result = await transcriptEngine.getCleanTranscript(url);

  if (!result.ok) {
    throw new Error(`Could not fetch YouTube captions for ${url}. ${result.message}`);
  }

  return writeAnalyzedNote({
    source: 'youtube',
    transcriptForAnalysis: result.transcript,
    transcriptForMarkdown: result.transcript,
    url
  });
}

async function saveEnvLocal(event: IpcMainInvokeEvent, payload: SaveEnvPayload): Promise<SaveEnvResult> {
  assertTrustedSender(event);

  if (typeof payload.content !== 'string' || !payload.content.trim()) {
    throw new Error('Paste env text first.');
  }

  const settings = readSettings();
  const parentWindow = BrowserWindow.fromWebContents(event.sender) ?? undefined;
  const defaultPath =
    settings.lastEnvDirectory && existsSync(settings.lastEnvDirectory)
      ? settings.lastEnvDirectory
      : undefined;
  const openDialogOptions: Electron.OpenDialogOptions = {
    title: 'Choose project folder for .env.local',
    defaultPath,
    properties: ['openDirectory', 'createDirectory']
  };

  const selection = parentWindow
    ? await dialog.showOpenDialog(parentWindow, openDialogOptions)
    : await dialog.showOpenDialog(openDialogOptions);

  if (selection.canceled || selection.filePaths.length === 0) {
    return { canceled: true };
  }

  const directory = selection.filePaths[0];
  const filePath = path.join(directory, '.env.local');
  const nextSettings = { ...readSettings(), lastEnvDirectory: directory };
  writeSettings(nextSettings);

  const alreadyExists = existsSync(filePath);
  if (alreadyExists) {
    const overwriteOptions: Electron.MessageBoxOptions = {
      type: 'warning',
      title: 'Overwrite .env.local?',
      message: '.env.local already exists in this folder.',
      detail: filePath,
      buttons: ['Cancel', 'Overwrite'],
      defaultId: 0,
      cancelId: 0,
      noLink: true
    };
    const overwrite = parentWindow
      ? await dialog.showMessageBox(parentWindow, overwriteOptions)
      : await dialog.showMessageBox(overwriteOptions);

    if (overwrite.response !== 1) {
      return { canceled: true };
    }
  }

  writeFileSync(filePath, payload.content);
  return { canceled: false, filePath, directory, overwritten: alreadyExists };
}

function copyMarkdown(payload: CopyMarkdownPayload): CopyMarkdownResult {
  const note = findNoteRecord(payload.noteId, payload.folder);
  const markdown = readFileSync(note.path, 'utf8');
  clipboard.writeText(markdown);

  return {
    noteId: note.id,
    bytes: Buffer.byteLength(markdown, 'utf8')
  };
}

function getNoteChat(payload: CopyMarkdownPayload) {
  const note = findNoteRecord(payload.noteId, payload.folder);
  return { messages: readChatHistory(note) };
}

async function sendNoteChat(payload: NoteChatPayload) {
  const note = findNoteRecord(payload.noteId, payload.folder);
  const message = typeof payload.message === 'string' ? payload.message.trim() : '';
  if (!message) {
    throw new Error('Ask a note question first.');
  }
  if (message.length > 2000) {
    throw new Error('Keep note chat questions under 2,000 characters.');
  }
  if (statSync(note.path).size > maxChatNoteBytes) {
    throw new Error('This note is too large for Phase 5 chat. Copy/export still works.');
  }

  const history = readChatHistory(note);
  const now = new Date().toISOString();
  const userMessage: FluxChatMessage = {
    id: randomUUID(),
    role: 'user',
    content: message,
    created: now
  };

  const provider = createOpenAIProvider();
  const noteMarkdown = readFileSync(note.path, 'utf8');
  const answer = await provider.chatWithNote(noteMarkdown, history, message);
  const assistantMessage: FluxChatMessage = {
    id: randomUUID(),
    role: 'assistant',
    content: answer,
    created: new Date().toISOString()
  };
  const messages = [...history, userMessage, assistantMessage];
  writeChatHistory(note, messages);

  return { messages };
}

async function exportMarkdown(event: IpcMainInvokeEvent, payload: CopyMarkdownPayload): Promise<ExportMarkdownResult> {
  assertTrustedSender(event);
  const note = findNoteRecord(payload.noteId, payload.folder);
  if (!existsSync(note.path)) {
    throw new Error(`Could not export missing note file ${note.id}.md.`);
  }

  const parentWindow = BrowserWindow.fromWebContents(event.sender) ?? undefined;
  const directory = defaultMarkdownExportDir;
  mkdirSync(directory, { recursive: true });
  const fileName = path.basename(note.path);
  const filePath = path.join(directory, fileName);
  const alreadyExists = existsSync(filePath);

  if (alreadyExists) {
    const overwriteOptions: Electron.MessageBoxOptions = {
      type: 'warning',
      title: 'Overwrite markdown note?',
      message: `${fileName} already exists in this folder.`,
      detail: filePath,
      buttons: ['Cancel', 'Overwrite'],
      defaultId: 0,
      cancelId: 0,
      noLink: true
    };
    const overwrite = parentWindow
      ? await dialog.showMessageBox(parentWindow, overwriteOptions)
      : await dialog.showMessageBox(overwriteOptions);

    if (overwrite.response !== 1) {
      return { canceled: true };
    }
  }

  copyFileSync(note.path, filePath);
  void shell.openPath(directory);
  return { canceled: false, filePath, directory, overwritten: alreadyExists };
}

function moveNote(payload: MoveNotePayload) {
  const dataDir = ensureLibrary();
  if (typeof payload.targetFolder !== 'string' || !payload.targetFolder.trim()) {
    throw new Error('Choose a target folder first.');
  }
  const folder = sanitizeFolderName(payload.targetFolder);
  const targetDir = path.join(dataDir, folder);
  mkdirSync(targetDir, { recursive: true });

  const current = findNoteRecord(payload.noteId, payload.sourceFolder);

  const targetPath = path.join(targetDir, `${current.id}.md`);
  if (path.normalize(current.path) === path.normalize(targetPath)) {
    return listLibrary();
  }

  if (existsSync(targetPath)) {
    throw new Error(`A note named ${current.id}.md already exists in ${folder}.`);
  }

  const chatSourcePath = getChatSidecarPath(current);
  const chatTargetPath = getChatSidecarPath(current, folder);
  const hasChatSidecar = existsSync(chatSourcePath);
  if (hasChatSidecar && existsSync(chatTargetPath)) {
    throw new Error(`Chat history for ${current.id}.md already exists in ${folder}.`);
  }

  const originalMarkdown = readFileSync(current.path, 'utf8');
  renameSync(current.path, targetPath);

  try {
    const markdown = originalMarkdown.replace(
      /^folder: .+$/m,
      `folder: ${folder}`
    );
    writeFileSync(targetPath, markdown);
    moveChatSidecar(current, folder);
  } catch (error) {
    try {
      if (existsSync(targetPath) && !existsSync(current.path)) {
        renameSync(targetPath, current.path);
        writeFileSync(current.path, originalMarkdown);
      }
    } catch {
      throw error;
    }
    throw error;
  }

  return listLibrary();
}

function safeBounds(bounds?: WindowBounds): WindowBounds {
  if (!bounds) {
    return defaultBounds;
  }

  const displays = screen.getAllDisplays().map((display) => display.workArea);
  const isVisible =
    bounds.x === undefined ||
    bounds.y === undefined ||
    displays.some(
      (area) =>
        bounds.x! < area.x + area.width &&
        bounds.x! + bounds.width > area.x &&
        bounds.y! < area.y + area.height &&
        bounds.y! + bounds.height > area.y
    );

  return isVisible ? bounds : defaultBounds;
}

function createWindow() {
  const settings = readSettings();
  const bounds = safeBounds(settings.windowBounds);
  const devServerUrl = getTrustedDevServerUrl();

  const mainWindow = new BrowserWindow({
    ...bounds,
    minWidth: 420,
    minHeight: 420,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: true,
    hasShadow: false,
    title: 'Flux',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.on('close', () => {
    writeSettings({
      ...readSettings(),
      windowBounds: mainWindow.getBounds()
    });
  });

  if (devServerUrl) {
    void mainWindow.loadURL(devServerUrl);
  } else {
    void mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}

app.whenReady().then(() => {
  loadLocalEnv();
  ensureLibrary();

  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const requestingUrl =
      details && 'requestingUrl' in details && typeof details.requestingUrl === 'string'
        ? details.requestingUrl
        : '';

    callback(
      permission === 'media' &&
        isTrustedRendererUrl(webContents.getURL()) &&
        (!requestingUrl || isTrustedRendererUrl(requestingUrl))
    );
  });

  ipcMain.handle('window:minimize', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize();
  });

  ipcMain.handle('window:close', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close();
  });

  ipcMain.handle('library:list', (event) => {
    assertTrustedSender(event);
    return listLibrary();
  });

  ipcMain.handle('library:create-folder', (event, payload: { name: string }) => {
    assertTrustedSender(event);
    const dataDir = ensureLibrary();
    const folder = sanitizeFolderName(payload.name);
    mkdirSync(path.join(dataDir, folder), { recursive: true });
    return { folder, library: listLibrary() };
  });

  ipcMain.handle(
    'library:move-note',
    (event, payload: MoveNotePayload) => {
      assertTrustedSender(event);
      return moveNote(payload);
    }
  );

  ipcMain.handle('capture:save-recording', (event, payload: SaveRecordingPayload) => {
    assertTrustedSender(event);
    return saveRecording(payload);
  });

  ipcMain.handle('capture:save-youtube-url', (event, payload: SaveYouTubePayload) => {
    assertTrustedSender(event);
    return saveYouTubeUrl(payload);
  });

  ipcMain.handle('capture:save-env-local', (event, payload: SaveEnvPayload) => {
    return saveEnvLocal(event, payload);
  });

  ipcMain.handle('note:copy-markdown', (event, payload: CopyMarkdownPayload) => {
    assertTrustedSender(event);
    return copyMarkdown(payload);
  });

  ipcMain.handle('note:export-markdown', (event, payload: CopyMarkdownPayload) => {
    return exportMarkdown(event, payload);
  });

  ipcMain.handle('note:get-chat', (event, payload: CopyMarkdownPayload) => {
    assertTrustedSender(event);
    return getNoteChat(payload);
  });

  ipcMain.handle('note:send-chat', (event, payload: NoteChatPayload) => {
    assertTrustedSender(event);
    return sendNoteChat(payload);
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
