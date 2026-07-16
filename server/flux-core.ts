import { randomUUID } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  writeFileSync
} from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  FluxAIProvider,
  FluxAIProviderFactory,
  FluxAnalysis,
  FluxAnalyzedTranscript,
  FluxCaptureDraft,
  FluxCoreOptions,
  FluxCreateTextNotePayload,
  FluxFolderMutationResult,
  FluxLibrarySnapshot,
  FluxNoteFilters,
  FluxNoteLocator,
  FluxNoteMutationResult,
  FluxNoteSource,
  FluxNoteSummary,
  FluxReadNoteResult,
  FluxSaveCaptureDraftPayload,
  FluxSaveRecordingPayload,
  FluxSaveWorkingListPayload,
  FluxSaveYouTubePayload,
  FluxTranscriptEngine,
  FluxWorkingList
} from '../shared/flux-contract.js';

type FluxNoteRecord = FluxNoteSummary & {
  filePath: string;
  markdown: string;
};

const transcriptNotesFolder = 'Transcript Notes';
const allowedAudioMimeTypes = new Set(['audio/webm', 'audio/mp4', 'audio/ogg', 'audio/wav']);
const allowedNoteSources = new Set<FluxNoteSource>(['text', 'voice', 'youtube']);
const maxAudioBytes = 25 * 1024 * 1024;
const defaultWorkingList: FluxWorkingList = { title: 'Flux list', items: [] };

export const defaultDataDir = path.join(os.homedir(), 'Flux');

function sanitizeFolderName(name: string) {
  const cleaned = name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '').trim();
  if (!cleaned || cleaned.startsWith('.')) {
    throw new Error('Folder name needs plain visible characters.');
  }
  return cleaned.slice(0, 64);
}

function normalizeNoteId(noteId: unknown) {
  if (typeof noteId !== 'string' || !noteId.trim()) {
    throw new Error('Choose a note first.');
  }

  const normalized = noteId.trim();
  if (normalized === '.' || normalized === '..' || path.basename(normalized) !== normalized) {
    throw new Error('Note identifier must not contain a path.');
  }
  return normalized;
}

function normalizeTitle(value: unknown, errorMessage: string) {
  if (typeof value !== 'string') {
    throw new Error(errorMessage);
  }
  const title = value.replace(/\s+/g, ' ').trim();
  if (!title) {
    throw new Error(errorMessage);
  }
  return title;
}

function slugify(input: string) {
  const slug = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return slug || 'voice-note';
}

function formatDateSlug(date: Date) {
  return date.toISOString().slice(0, 10);
}

function escapeFrontmatterValue(value: string) {
  return value.replace(/"/g, '\\"');
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
  const lines = markdown.split(/\r?\n/);
  const startIndex = lines.findIndex((line) => line.trim() === '## Transcript');
  if (startIndex === -1) {
    return '';
  }

  return lines.slice(startIndex + 1).join('\n').trim();
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

function sourceFromFrontmatter(value: string | undefined): FluxNoteSource {
  if (value && allowedNoteSources.has(value as FluxNoteSource)) {
    return value as FluxNoteSource;
  }
  return 'voice';
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
${urlLine}${analysisModel}---
# ${note.title}
${analysisSection}## Transcript
${transcript.trim()}
`;
}

function toPublicNote(record: FluxNoteRecord): FluxNoteSummary {
  const { filePath: _filePath, markdown: _markdown, ...note } = record;
  return note;
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

function validateRecordingPayload(payload: FluxSaveRecordingPayload) {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Recording payload was not valid audio bytes.');
  }

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
  if (
    host !== 'youtube.com' &&
    host !== 'm.youtube.com' &&
    host !== 'music.youtube.com' &&
    host !== 'youtu.be'
  ) {
    throw new Error(`That is not a YouTube URL: ${input}`);
  }

  return parsed.toString();
}

function normalizeAnalysis(value: FluxAnalyzedTranscript): FluxAnalyzedTranscript {
  if (!value || typeof value !== 'object') {
    throw new Error('AI provider returned an invalid analysis payload.');
  }

  const title = normalizeTitle(value.title, 'AI analysis was missing a title.');
  const model = normalizeTitle(value.model, 'AI analysis was missing a model.');
  const topline = typeof value.topline === 'string' ? value.topline.trim() : '';
  if (!topline) {
    throw new Error('AI analysis was missing a topline.');
  }
  if (!Array.isArray(value.nextSteps) || value.nextSteps.some((step) => typeof step !== 'string')) {
    throw new Error('AI analysis returned invalid next steps.');
  }

  return {
    title,
    model,
    topline,
    nextSteps: value.nextSteps.map((step) => step.trim()).filter(Boolean).slice(0, 6)
  };
}

function loadDefaultTranscriptEngine(): FluxTranscriptEngine {
  const require = createRequire(import.meta.url);
  const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  const candidates = [
    path.resolve(moduleDirectory, '../scripts/transcript.cjs'),
    path.resolve(moduleDirectory, '../../scripts/transcript.cjs'),
    ...(resourcesPath ? [path.resolve(resourcesPath, 'scripts/transcript.cjs')] : [])
  ];

  for (const candidate of candidates) {
    if (!existsSync(candidate) || !lstatSync(candidate).isFile()) {
      continue;
    }

    const loaded = require(candidate) as unknown;
    if (
      loaded &&
      typeof loaded === 'object' &&
      'getCleanTranscript' in loaded &&
      typeof loaded.getCleanTranscript === 'function'
    ) {
      return loaded as FluxTranscriptEngine;
    }
    throw new Error(`Flux transcript engine at ${candidate} has an invalid export.`);
  }

  throw new Error('Could not load scripts/transcript.cjs. Inject a Flux transcript engine.');
}

export class FluxCore {
  private readonly dataDir: string;
  private readonly aiProviderFactory?: FluxAIProviderFactory;
  private transcriptEngine?: FluxTranscriptEngine;

  constructor({ dataDir, aiProviderFactory, transcriptEngine }: FluxCoreOptions = {}) {
    if (dataDir !== undefined && (typeof dataDir !== 'string' || !dataDir.trim())) {
      throw new Error('Flux data directory must be a non-empty path.');
    }

    this.dataDir = path.resolve(dataDir ?? defaultDataDir);
    this.aiProviderFactory = aiProviderFactory;
    this.transcriptEngine = transcriptEngine;
  }

  listLibrary(filters: FluxNoteFilters = {}): FluxLibrarySnapshot {
    const dataDir = this.ensureLibrary();
    const folders = readdirSync(dataDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
      .map((entry) => entry.name)
      .sort((a, b) => (a === 'Inbox' ? -1 : b === 'Inbox' ? 1 : a.localeCompare(b)));

    const folderSummaries = folders.map((folder) => ({
      name: folder,
      count: this.getMarkdownFiles(this.resolveLibraryPath(folder)).length
    }));

    let notes = this.listNoteRecords(dataDir).map(toPublicNote);
    if (filters.folder !== undefined) {
      const folder = sanitizeFolderName(filters.folder);
      notes = notes.filter((note) => note.folder === folder);
    }
    if (filters.source !== undefined) {
      if (!allowedNoteSources.has(filters.source)) {
        throw new Error(`Unsupported note source: ${String(filters.source)}.`);
      }
      notes = notes.filter((note) => note.source === filters.source);
    }

    return { folders: folderSummaries, notes };
  }

  readNote({ noteId, folder }: FluxNoteLocator): FluxReadNoteResult {
    const record = this.findNoteRecord(noteId, folder);
    return { note: toPublicNote(record), markdown: record.markdown };
  }

  createTextNote({ title, content, folder = 'Inbox' }: FluxCreateTextNotePayload): FluxNoteMutationResult {
    const normalizedTitle = normalizeTitle(title, 'Write a note title first.');
    if (typeof content !== 'string' || !content.trim()) {
      throw new Error('Write note text first.');
    }

    const normalizedFolder = sanitizeFolderName(folder);
    const folderPath = this.resolveLibraryPath(normalizedFolder);
    this.ensureLibrary();
    mkdirSync(folderPath, { recursive: true });

    const created = new Date();
    const { noteId, notePath } = this.uniqueMarkdownPath(
      folderPath,
      `${formatDateSlug(created)}-${slugify(normalizedTitle)}`
    );
    const note: FluxNoteSummary = {
      id: noteId,
      title: normalizedTitle,
      source: 'text',
      created: created.toISOString(),
      folder: normalizedFolder,
      transcript: content.trim(),
      transcriptPreview: previewTranscript(content.trim())
    };
    writeFileSync(notePath, createMarkdownNote(note, content), 'utf8');
    return { note, library: this.listLibrary() };
  }

  async saveRecording(payload: FluxSaveRecordingPayload): Promise<FluxNoteMutationResult> {
    const dataDir = this.ensureLibrary();
    const { audioBuffer, mimeType } = validateRecordingPayload(payload);
    const created = new Date();
    const audioId = `${formatDateSlug(created)}-${created.getTime()}`;
    const audioDir = this.resolveLibraryPath('.flux', 'audio', audioId);
    mkdirSync(audioDir, { recursive: true });

    const audioPath = this.resolveLibraryPath(
      '.flux',
      'audio',
      audioId,
      `recording.${audioExtension(mimeType)}`
    );
    writeFileSync(audioPath, audioBuffer);

    const provider = await this.getAIProvider();
    const transcript = (await provider.transcribeAudio(audioPath, mimeType)).trim();
    if (!transcript) {
      throw new Error('AI provider returned an empty transcript.');
    }

    const analysis = normalizeAnalysis(await provider.analyzeTranscript(transcript));
    return this.writeAnalyzedNote(dataDir, created, transcript, analysis);
  }

  async saveYouTubeUrl(payload: FluxSaveYouTubePayload): Promise<FluxNoteMutationResult> {
    const url = normalizeYouTubeUrl(payload?.url);
    const result = await this.getTranscriptEngine().getCleanTranscript(url);
    if (!result.ok) {
      throw new Error(`Could not fetch YouTube captions for ${url}. ${result.message}`);
    }
    if (!result.transcript.trim()) {
      throw new Error(`Could not fetch YouTube captions for ${url}. The transcript was empty.`);
    }

    const folderPath = this.resolveLibraryPath(transcriptNotesFolder);
    this.ensureLibrary();
    mkdirSync(folderPath, { recursive: true });
    const created = new Date();
    const title = 'YouTube transcript';
    const { noteId, notePath } = this.uniqueMarkdownPath(
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
      transcript: result.transcript,
      transcriptPreview: previewTranscript(result.transcript)
    };
    writeFileSync(notePath, createMarkdownNote(note, result.transcript), 'utf8');
    return { note, library: this.listLibrary() };
  }

  createFolder(name: string): FluxFolderMutationResult {
    const folder = sanitizeFolderName(name);
    this.ensureLibrary();
    mkdirSync(this.resolveLibraryPath(folder), { recursive: true });
    return { folder, library: this.listLibrary() };
  }

  moveNote(noteId: string, targetFolder: string): FluxLibrarySnapshot {
    const normalizedNoteId = normalizeNoteId(noteId);
    const folder = sanitizeFolderName(targetFolder);
    const dataDir = this.ensureLibrary();
    const targetDir = this.resolveLibraryPath(folder);
    mkdirSync(targetDir, { recursive: true });

    const current = this.listNoteRecords(dataDir).find((note) => note.id === normalizedNoteId);
    if (!current) {
      throw new Error(`Could not find note ${normalizedNoteId}.`);
    }

    const targetPath = this.resolveLibraryPath(folder, `${normalizedNoteId}.md`);
    if (path.normalize(current.filePath) === path.normalize(targetPath)) {
      return this.listLibrary();
    }
    if (existsSync(targetPath)) {
      throw new Error(`A note named ${normalizedNoteId}.md already exists in ${folder}.`);
    }

    renameSync(current.filePath, targetPath);
    const markdown = readFileSync(targetPath, 'utf8').replace(/^folder: .+$/m, `folder: ${folder}`);
    writeFileSync(targetPath, markdown, 'utf8');
    return this.listLibrary();
  }

  readWorkingList(): FluxWorkingList {
    this.ensureLibrary();
    const workingListPath = this.resolveLibraryPath('.flux', 'working-list.json');
    if (!existsSync(workingListPath)) {
      return { ...defaultWorkingList, items: [] };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(workingListPath, 'utf8')) as unknown;
    } catch (error) {
      throw new Error(
        `Could not read Flux working list: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    return this.validateWorkingList(parsed);
  }

  saveWorkingList({ title, items }: FluxSaveWorkingListPayload): FluxWorkingList {
    const normalizedTitle = normalizeTitle(title, 'Write a working list title first.');
    if (!Array.isArray(items) || items.some((item) => typeof item !== 'string')) {
      throw new Error('Working list items must be text.');
    }

    const workingList: FluxWorkingList = {
      title: normalizedTitle,
      items: items.map((item) => item.trim()).filter(Boolean),
      updatedAt: new Date().toISOString()
    };
    this.ensureLibrary();
    const workingListPath = this.resolveLibraryPath('.flux', 'working-list.json');
    const tempPath = this.resolveLibraryPath('.flux', `working-list.${randomUUID()}.tmp`);
    writeFileSync(tempPath, `${JSON.stringify(workingList, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx'
    });
    renameSync(tempPath, workingListPath);
    return workingList;
  }

  readCaptureDraft(): FluxCaptureDraft {
    this.ensureLibrary();
    const captureDraftPath = this.resolveLibraryPath('.flux', 'capture-draft.json');
    if (!existsSync(captureDraftPath)) {
      return { text: '' };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(captureDraftPath, 'utf8')) as unknown;
    } catch (error) {
      throw new Error(
        `Could not read Flux capture draft: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    if (!parsed || typeof parsed !== 'object' || typeof (parsed as Record<string, unknown>).text !== 'string') {
      throw new Error('Flux capture draft text is invalid.');
    }
    return { text: (parsed as { text: string }).text };
  }

  saveCaptureDraft({ text }: FluxSaveCaptureDraftPayload): FluxCaptureDraft {
    if (typeof text !== 'string') {
      throw new Error('Flux capture draft must be text.');
    }

    const captureDraft: FluxCaptureDraft = { text };
    this.ensureLibrary();
    const captureDraftPath = this.resolveLibraryPath('.flux', 'capture-draft.json');
    const tempPath = this.resolveLibraryPath('.flux', `capture-draft.${randomUUID()}.tmp`);
    writeFileSync(tempPath, `${JSON.stringify(captureDraft, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx'
    });
    renameSync(tempPath, captureDraftPath);
    return captureDraft;
  }

  private ensureLibrary() {
    mkdirSync(this.dataDir, { recursive: true });
    mkdirSync(this.resolveLibraryPath('Inbox'), { recursive: true });
    mkdirSync(this.resolveLibraryPath('.flux', 'audio'), { recursive: true });
    return this.dataDir;
  }

  private resolveLibraryPath(...segments: string[]) {
    const candidate = path.resolve(this.dataDir, ...segments);
    const relative = path.relative(this.dataDir, candidate);
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new Error('Path is outside the Flux data directory.');
    }

    if (relative) {
      let current = this.dataDir;
      for (const segment of relative.split(path.sep)) {
        current = path.join(current, segment);
        if (existsSync(current) && lstatSync(current).isSymbolicLink()) {
          throw new Error('Symbolic links are not allowed inside the Flux data directory.');
        }
      }
    }
    return candidate;
  }

  private getMarkdownFiles(folderPath: string) {
    return readdirSync(folderPath, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.md'))
      .map((entry) => entry.name)
      .sort((a, b) => {
        const aTime = statSync(path.join(folderPath, a)).mtimeMs;
        const bTime = statSync(path.join(folderPath, b)).mtimeMs;
        return bTime - aTime;
      });
  }

  private listNoteRecords(dataDir = this.ensureLibrary()): FluxNoteRecord[] {
    const folders = readdirSync(dataDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
      .map((entry) => entry.name)
      .sort((a, b) => (a === 'Inbox' ? -1 : b === 'Inbox' ? 1 : a.localeCompare(b)));
    const notes: FluxNoteRecord[] = [];

    for (const folder of folders) {
      const folderPath = this.resolveLibraryPath(folder);
      for (const file of this.getMarkdownFiles(folderPath)) {
        const filePath = this.resolveLibraryPath(folder, file);
        const markdown = readFileSync(filePath, 'utf8');
        const meta = parseFrontmatter(markdown);
        const transcript = extractTranscript(markdown);
        notes.push({
          id: file.replace(/\.md$/i, ''),
          title: meta.title || file.replace(/\.md$/i, '').replace(/-/g, ' '),
          source: sourceFromFrontmatter(meta.source),
          created: meta.created || statSync(filePath).mtime.toISOString(),
          folder,
          url: meta.url,
          analysis: extractAnalysis(markdown, meta),
          transcript,
          transcriptPreview: previewTranscript(transcript),
          filePath,
          markdown
        });
      }
    }

    notes.sort((a, b) => Date.parse(b.created) - Date.parse(a.created));
    return notes;
  }

  private findNoteRecord(noteId: unknown, folder: unknown) {
    const normalizedNoteId = normalizeNoteId(noteId);
    if (typeof folder !== 'string' || !folder.trim()) {
      throw new Error('Choose a note folder first.');
    }
    const normalizedFolder = sanitizeFolderName(folder);
    const record = this.listNoteRecords().find(
      (note) => note.id === normalizedNoteId && note.folder === normalizedFolder
    );
    if (!record) {
      throw new Error(`Could not find ${normalizedNoteId}.md in ${normalizedFolder}.`);
    }
    return record;
  }

  private uniqueMarkdownPath(folderPath: string, baseNoteId: string) {
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

  private async getAIProvider(): Promise<FluxAIProvider> {
    if (!this.aiProviderFactory) {
      throw new Error('Flux voice capture needs an injected AI provider factory.');
    }
    const provider = await this.aiProviderFactory();
    if (
      !provider ||
      typeof provider.transcribeAudio !== 'function' ||
      typeof provider.analyzeTranscript !== 'function'
    ) {
      throw new Error('Flux AI provider factory returned an invalid provider.');
    }
    return provider;
  }

  private getTranscriptEngine() {
    if (!this.transcriptEngine) {
      this.transcriptEngine = loadDefaultTranscriptEngine();
    }
    return this.transcriptEngine;
  }

  private writeAnalyzedNote(
    dataDir: string,
    created: Date,
    transcript: string,
    analysisWithTitle: FluxAnalyzedTranscript
  ): FluxNoteMutationResult {
    const { title, ...analysis } = analysisWithTitle;
    const folderPath = this.resolveLibraryPath('Inbox');
    const { noteId, notePath } = this.uniqueMarkdownPath(
      folderPath,
      `${formatDateSlug(created)}-${slugify(title)}`
    );
    const note: FluxNoteSummary = {
      id: noteId,
      title,
      source: 'voice',
      created: created.toISOString(),
      folder: 'Inbox',
      analysis,
      transcript,
      transcriptPreview: previewTranscript(transcript)
    };
    writeFileSync(notePath, createMarkdownNote(note, transcript), 'utf8');
    return { note, library: this.listLibrary() };
  }

  private validateWorkingList(value: unknown): FluxWorkingList {
    if (!value || typeof value !== 'object') {
      throw new Error('Flux working list must be a JSON object.');
    }

    const candidate = value as Record<string, unknown>;
    const title = normalizeTitle(candidate.title, 'Flux working list title is invalid.');
    if (
      !Array.isArray(candidate.items) ||
      candidate.items.some((item) => typeof item !== 'string') ||
      (candidate.updatedAt !== undefined && typeof candidate.updatedAt !== 'string')
    ) {
      throw new Error('Flux working list items are invalid.');
    }

    return {
      title,
      items: candidate.items.map((item) => item.trim()).filter(Boolean),
      ...(typeof candidate.updatedAt === 'string' ? { updatedAt: candidate.updatedAt } : {})
    };
  }
}
