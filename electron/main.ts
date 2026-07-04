import {
  app,
  BrowserWindow,
  clipboard,
  desktopCapturer,
  dialog,
  ipcMain,
  IpcMainInvokeEvent,
  Menu,
  nativeImage,
  screen,
  session,
  shell
} from 'electron';
import OpenAI, { toFile } from 'openai';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
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
  transcript: string;
  transcriptPreview: string;
};

type FluxNoteRecord = FluxNoteSummary & {
  path: string;
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

type ListMarkdownPayload = {
  title: unknown;
  markdown: unknown;
};

type ScreenshotPayload = {
  filePath: unknown;
};

type ListCopyMarkdownResult = {
  bytes: number;
};

type CopyMarkdownResult = {
  noteId: string;
  bytes: number;
};

type ExportMarkdownResult =
  | { canceled: true }
  | { canceled: false; filePath: string; directory: string; overwritten: boolean };

type ListMarkdownResult = {
  filePath: string;
  directory: string;
};

type FluxScreenshot = {
  id: string;
  filePath: string;
  fileName: string;
  created: string;
  dataUrl: string;
  width: number;
  height: number;
};

type AIProvider = {
  transcribeAudio: (audioPath: string, mimeType: string) => Promise<string>;
  analyzeTranscript: (transcript: string) => Promise<FluxAnalysis & { title: string }>;
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
const transcriptNotesFolder = 'Transcript Notes';
const screenshotsFolder = 'Screenshots';
const defaultMarkdownExportDir = path.join(
  os.homedir(),
  'OneDrive',
  'Desktop',
  'Flux Cowork',
  'Saved Flux Notes'
);
const settingsDir = path.join(defaultDataDir, '.flux');
const settingsPath = path.join(settingsDir, 'settings.json');
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
  mkdirSync(path.join(dataDir, screenshotsFolder), { recursive: true });
  return dataDir;
}

function getScreenshotsDir() {
  const directory = path.join(ensureLibrary(), screenshotsFolder);
  mkdirSync(directory, { recursive: true });
  return directory;
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
  return extractSection(markdown, 'Transcript');
}

function previewTranscript(transcript: string) {
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
        transcript: extractTranscript(markdown),
        transcriptPreview: previewTranscript(extractTranscript(markdown)),
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
    transcript: transcriptForMarkdown,
    transcriptPreview: transcriptForMarkdown.replace(/\s+/g, ' ').slice(0, 180)
  };
  writeFileSync(notePath, createMarkdownNote(note, transcriptForMarkdown));

  return { note, library: listLibrary() };
}

async function writeTranscriptNote({
  transcript,
  url
}: {
  transcript: string;
  url: string;
}) {
  const dataDir = ensureLibrary();
  const folderPath = path.join(dataDir, transcriptNotesFolder);
  mkdirSync(folderPath, { recursive: true });
  const created = new Date();
  const title = 'YouTube transcript';
  const { noteId, notePath } = uniqueMarkdownPath(
    folderPath,
    `${formatDateSlug(created)}-${slugify(title)}`
  );
  const note: FluxNoteSummary = {
    id: noteId,
    title,
    source: 'youtube',
    created: created.toISOString(),
    folder: transcriptNotesFolder,
    url,
    transcript,
    transcriptPreview: previewTranscript(transcript)
  };
  writeFileSync(notePath, createMarkdownNote(note, transcript));

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

  return writeTranscriptNote({
    transcript: result.transcript,
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
      message: `${path.basename(filePath)} already exists in this folder.`,
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

  const content = payload.content.trimEnd();
  mkdirSync(directory, { recursive: true });
  writeFileSync(filePath, `${content}\n`, { encoding: 'utf8', flag: 'w' });
  const savedContent = readFileSync(filePath, 'utf8');
  if (!existsSync(filePath) || savedContent.trimEnd() !== content) {
    throw new Error(`Could not verify saved file ${filePath}.`);
  }
  shell.showItemInFolder(filePath);
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

async function exportMarkdown(event: IpcMainInvokeEvent, payload: CopyMarkdownPayload): Promise<ExportMarkdownResult> {
  assertTrustedSender(event);
  const note = findNoteRecord(payload.noteId, payload.folder);
  if (!existsSync(note.path)) {
    throw new Error(`Could not export missing note file ${note.id}.md.`);
  }

  const parentWindow = BrowserWindow.fromWebContents(event.sender) ?? undefined;
  const directory =
    note.source === 'youtube' ? path.join(getDataDir(), transcriptNotesFolder) : defaultMarkdownExportDir;
  mkdirSync(directory, { recursive: true });
  const fileName = path.basename(note.path);
  const filePath = path.join(directory, fileName);
  if (path.normalize(note.path) === path.normalize(filePath)) {
    void shell.openPath(directory);
    return { canceled: false, filePath, directory, overwritten: false };
  }
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

function exportListMarkdown(event: IpcMainInvokeEvent, payload: ListMarkdownPayload): ListMarkdownResult {
  assertTrustedSender(event);
  const title = typeof payload.title === 'string' && payload.title.trim() ? payload.title.trim() : 'Flux list';
  const markdown = typeof payload.markdown === 'string' ? payload.markdown.trim() : '';
  if (!markdown) {
    throw new Error('Write a list before exporting.');
  }

  const directory = path.join(getDataDir(), 'Lists');
  mkdirSync(directory, { recursive: true });
  const { notePath } = uniqueMarkdownPath(directory, `${formatDateSlug(new Date())}-${slugify(title)}`);
  writeFileSync(notePath, `${markdown}\n`);
  void shell.openPath(directory);
  return { filePath: notePath, directory };
}

function copyListMarkdown(event: IpcMainInvokeEvent, payload: ListMarkdownPayload): ListCopyMarkdownResult {
  assertTrustedSender(event);
  const markdown = typeof payload.markdown === 'string' ? payload.markdown.trim() : '';
  if (!markdown) {
    throw new Error('Write a list before copying.');
  }

  clipboard.writeText(`${markdown}\n`);
  return { bytes: Buffer.byteLength(`${markdown}\n`, 'utf8') };
}

function screenshotFromFile(filePath: string): FluxScreenshot {
  const image = nativeImage.createFromPath(filePath);
  const size = image.getSize();
  const stats = statSync(filePath);
  return {
    id: path.basename(filePath, '.png'),
    filePath,
    fileName: path.basename(filePath),
    created: stats.mtime.toISOString(),
    dataUrl: image.toDataURL(),
    width: size.width,
    height: size.height
  };
}

function listScreenshots(): FluxScreenshot[] {
  const directory = getScreenshotsDir();
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.png'))
    .map((entry) => path.join(directory, entry.name))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)
    .slice(0, 40)
    .map(screenshotFromFile);
}

async function captureScreenshot(event: IpcMainInvokeEvent): Promise<{ screenshot: FluxScreenshot; screenshots: FluxScreenshot[] }> {
  assertTrustedSender(event);
  const parentWindow = BrowserWindow.fromWebContents(event.sender) ?? undefined;
  const display = parentWindow
    ? screen.getDisplayNearestPoint(parentWindow.getBounds())
    : screen.getPrimaryDisplay();
  const thumbnailSize = {
    width: Math.round(display.size.width * display.scaleFactor),
    height: Math.round(display.size.height * display.scaleFactor)
  };
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize
  });
  const source =
    sources.find((candidate) => candidate.display_id === String(display.id)) ??
    sources[0];

  if (!source || source.thumbnail.isEmpty()) {
    throw new Error('Could not capture the screen.');
  }

  const created = new Date();
  const directory = getScreenshotsDir();
  const fileName = `${formatDateSlug(created)}-${created.getHours().toString().padStart(2, '0')}${created
    .getMinutes()
    .toString()
    .padStart(2, '0')}${created.getSeconds().toString().padStart(2, '0')}-screenshot.png`;
  const filePath = path.join(directory, fileName);
  writeFileSync(filePath, source.thumbnail.toPNG());
  const screenshot = screenshotFromFile(filePath);
  return { screenshot, screenshots: listScreenshots() };
}

function normalizeScreenshotPath(payload: ScreenshotPayload) {
  if (typeof payload.filePath !== 'string' || !payload.filePath.trim()) {
    throw new Error('Choose a screenshot first.');
  }

  const directory = path.normalize(getScreenshotsDir());
  const filePath = path.normalize(payload.filePath);
  if (!filePath.startsWith(directory + path.sep) || !existsSync(filePath)) {
    throw new Error('Screenshot is outside the Flux screenshot folder.');
  }

  return filePath;
}

function copyScreenshot(event: IpcMainInvokeEvent, payload: ScreenshotPayload) {
  assertTrustedSender(event);
  const filePath = normalizeScreenshotPath(payload);
  const image = nativeImage.createFromPath(filePath);
  if (image.isEmpty()) {
    throw new Error('Could not copy an empty screenshot.');
  }

  clipboard.writeImage(image);
  return screenshotFromFile(filePath);
}

async function saveScreenshot(event: IpcMainInvokeEvent, payload: ScreenshotPayload): Promise<ExportMarkdownResult> {
  assertTrustedSender(event);
  const sourcePath = normalizeScreenshotPath(payload);
  const parentWindow = BrowserWindow.fromWebContents(event.sender) ?? undefined;
  const saveOptions: Electron.SaveDialogOptions = {
    title: 'Save screenshot',
    defaultPath: path.join(os.homedir(), 'Pictures', path.basename(sourcePath)),
    filters: [{ name: 'PNG image', extensions: ['png'] }]
  };
  const selection = parentWindow
    ? await dialog.showSaveDialog(parentWindow, saveOptions)
    : await dialog.showSaveDialog(saveOptions);

  if (selection.canceled || !selection.filePath) {
    return { canceled: true };
  }

  const targetPath = selection.filePath.toLowerCase().endsWith('.png')
    ? selection.filePath
    : `${selection.filePath}.png`;
  copyFileSync(sourcePath, targetPath);
  shell.showItemInFolder(targetPath);
  return {
    canceled: false,
    filePath: targetPath,
    directory: path.dirname(targetPath),
    overwritten: false
  };
}

function openScreenshotsFolder(event: IpcMainInvokeEvent) {
  assertTrustedSender(event);
  const directory = getScreenshotsDir();
  void shell.openPath(directory);
  return { directory };
}

function moveNote(noteId: string, targetFolder: string) {
  const dataDir = ensureLibrary();
  const folder = sanitizeFolderName(targetFolder);
  const targetDir = path.join(dataDir, folder);
  mkdirSync(targetDir, { recursive: true });

  const current = listNoteRecords(dataDir).find((note) => note.id === noteId);
  if (!current) {
    throw new Error(`Could not find note ${noteId}.`);
  }

  const targetPath = path.join(targetDir, `${noteId}.md`);
  if (path.normalize(current.path) === path.normalize(targetPath)) {
    return listLibrary();
  }

  if (existsSync(targetPath)) {
    throw new Error(`A note named ${noteId}.md already exists in ${folder}.`);
  }

  renameSync(current.path, targetPath);

  const markdown = readFileSync(targetPath, 'utf8').replace(
    /^folder: .+$/m,
    `folder: ${folder}`
  );
  writeFileSync(targetPath, markdown);
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

  mainWindow.webContents.on('context-menu', (_event, params) => {
    const hasText = params.selectionText.trim().length > 0;
    const template: Electron.MenuItemConstructorOptions[] = [
      { role: 'undo', enabled: params.editFlags.canUndo },
      { role: 'redo', enabled: params.editFlags.canRedo },
      { type: 'separator' },
      { role: 'cut', enabled: params.editFlags.canCut },
      { role: 'copy', enabled: hasText || params.editFlags.canCopy },
      { role: 'paste', enabled: params.editFlags.canPaste },
      { role: 'selectAll', enabled: params.editFlags.canSelectAll }
    ];

    Menu.buildFromTemplate(template).popup({ window: mainWindow });
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
    (event, payload: { noteId: string; targetFolder: string }) => {
      assertTrustedSender(event);
      return moveNote(payload.noteId, payload.targetFolder);
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

  ipcMain.handle('list:export-markdown', (event, payload: ListMarkdownPayload) => {
    return exportListMarkdown(event, payload);
  });

  ipcMain.handle('list:copy-markdown', (event, payload: ListMarkdownPayload) => {
    return copyListMarkdown(event, payload);
  });

  ipcMain.handle('screenshot:list', (event) => {
    assertTrustedSender(event);
    return listScreenshots();
  });

  ipcMain.handle('screenshot:capture', (event) => {
    return captureScreenshot(event);
  });

  ipcMain.handle('screenshot:copy', (event, payload: ScreenshotPayload) => {
    return copyScreenshot(event, payload);
  });

  ipcMain.handle('screenshot:save', (event, payload: ScreenshotPayload) => {
    return saveScreenshot(event, payload);
  });

  ipcMain.handle('screenshot:open-folder', (event) => {
    return openScreenshotsFolder(event);
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
