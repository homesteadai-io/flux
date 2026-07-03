import { app, BrowserWindow, ipcMain, IpcMainInvokeEvent, screen, session } from 'electron';
import { GoogleGenAI } from '@google/genai';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  existsSync,
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
  modelId?: string;
};

type FluxFolder = {
  name: string;
  count: number;
};

type FluxNoteSummary = {
  id: string;
  title: string;
  source: 'voice' | 'youtube';
  created: string;
  folder: string;
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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultBounds: WindowBounds = { width: 980, height: 660 };
const defaultDataDir = path.join(os.homedir(), 'Flux');
const settingsDir = path.join(defaultDataDir, '.flux');
const settingsPath = path.join(settingsDir, 'settings.json');
const defaultModelId = 'gemini-2.5-flash';
const allowedLocalEnvKeys = new Set(['GEMINI_API_KEY', 'GOOGLE_API_KEY']);
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
    const value = line.slice(separator + 1).trim().replace(/^['"]|['"]$/g, '');
    data[key] = value;
  }
  return data;
}

function extractTranscript(markdown: string) {
  const transcript = markdown.split(/^## Transcript\s*$/m)[1]?.trim() ?? '';
  return transcript.replace(/\s+/g, ' ').slice(0, 180);
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

function formatDateSlug(date: Date) {
  return date.toISOString().slice(0, 10);
}

function buildTitle(transcript: string) {
  const words = transcript.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  if (words.length === 0) {
    return 'Untitled voice note';
  }

  const title = words.slice(0, 8).join(' ');
  return title.length > 72 ? `${title.slice(0, 69)}...` : title;
}

async function transcribeAudio(audioPath: string, mimeType: string) {
  const apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is missing. Add it to .env.local and restart Flux.');
  }

  const model = readSettings().modelId ?? defaultModelId;
  const ai = new GoogleGenAI({ apiKey });
  const audioBase64 = readFileSync(audioPath).toString('base64');
  const response = await ai.models.generateContent({
    model,
    contents: [
      {
        text:
          'Transcribe this voice note verbatim. Return only the transcript text. Do not summarize or invent missing words.'
      },
      {
        inlineData: {
          mimeType,
          data: audioBase64
        }
      }
    ]
  });

  const transcript = response.text?.trim();
  if (!transcript) {
    throw new Error('Gemini returned an empty transcript.');
  }
  return transcript;
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
  return `---
title: "${note.title.replace(/"/g, '\\"')}"
source: voice
created: ${note.created}
folder: ${note.folder}
---
# ${note.title}
## Transcript
${transcript.trim()}
`;
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

  const transcript = await transcribeAudio(audioPath, mimeType);
  const title = buildTitle(transcript);
  const { noteId, notePath } = uniqueMarkdownPath(
    path.join(dataDir, 'Inbox'),
    `${formatDateSlug(created)}-${slugify(title)}`
  );
  const note: FluxNoteSummary = {
    id: noteId,
    title,
    source: 'voice',
    created: created.toISOString(),
    folder: 'Inbox',
    transcriptPreview: transcript.replace(/\s+/g, ' ').slice(0, 180)
  };
  writeFileSync(notePath, createMarkdownNote(note, transcript));

  return { note, library: listLibrary() };
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
