import { randomUUID } from 'node:crypto';
import {
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync
} from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fluxWorkingListItemLimit } from '../shared/flux-contract.js';
import type {
  FluxAIProvider,
  FluxAIProviderFactory,
  FluxAnalysis,
  FluxAnalyzedTranscript,
  FluxCaptureDraft,
  FluxClaimVideoHandoffPayload,
  FluxCodexTaskReference,
  FluxCompleteVideoHandoffPayload,
  FluxCoreOptions,
  FluxCreateVideoHandoffPayload,
  FluxCreateTextNotePayload,
  FluxFailVideoHandoffPayload,
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
  FluxVideoHandoff,
  FluxVideoHandoffState,
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
const maxTranscriptCharacters = 1_000_000;
const maxAnalysisCharacters = 1_000_000;
const minimumRepeatedTranscriptTokens = 1;
const videoHandoffStates = new Set<FluxVideoHandoffState>([
  'generated',
  'queued',
  'claimed',
  'analysis_ready',
  'failed'
]);
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

function normalizeTaskId(value: unknown) {
  if (typeof value !== 'string') {
    throw new Error('Codex task ID is required.');
  }
  const taskId = value.trim();
  if (!taskId || taskId.length > 160 || /[\\/\u0000-\u001f]/u.test(taskId)) {
    throw new Error('Codex task ID is invalid.');
  }
  return taskId;
}

function normalizeHandoffId(value: unknown) {
  if (typeof value !== 'string') {
    throw new Error('Flux handoff ID is required.');
  }
  const handoffId = value.trim();
  if (!/^[a-f0-9-]{36}$/iu.test(handoffId)) {
    throw new Error('Flux handoff ID is invalid.');
  }
  return handoffId;
}

function normalizeBoundTask(value: unknown): FluxCodexTaskReference {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Flux Codex task binding is invalid.');
  }
  const task = value as Record<string, unknown>;
  if (typeof task.boundAt !== 'string' || !Number.isFinite(Date.parse(task.boundAt))) {
    throw new Error('Flux Codex task binding timestamp is invalid.');
  }
  const taskName =
    task.taskName === undefined
      ? undefined
      : normalizeTitle(task.taskName, 'Flux Codex task name is invalid.').slice(0, 160);
  return {
    taskId: normalizeTaskId(task.taskId),
    ...(taskName ? { taskName } : {}),
    boundAt: task.boundAt
  };
}

function normalizeTimestamp(value: unknown, label: string) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
}

function normalizeBoundedText(value: unknown, label: string, maximum: number) {
  if (typeof value !== 'string') {
    throw new Error(`${label} must be text.`);
  }
  const text = value.trim();
  if (!text || text.length > maximum) {
    throw new Error(`${label} is invalid.`);
  }
  return text;
}

function normalizeTranscriptToken(token: string) {
  return token.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

export function removeRepeatedTranscriptBlocks(value: string) {
  const transcript = value.replace(/\r\n?/g, '\n').trim();
  const matches = Array.from(transcript.matchAll(/\S+/gu));
  if (matches.length < minimumRepeatedTranscriptTokens * 2) {
    return transcript;
  }

  const tokens = matches.map((match) => normalizeTranscriptToken(match[0]));
  const signatureLength = Math.min(12, minimumRepeatedTranscriptTokens);
  for (
    let candidate = minimumRepeatedTranscriptTokens;
    candidate <= tokens.length - minimumRepeatedTranscriptTokens;
    candidate += 1
  ) {
    let signatureMatches = true;
    for (let offset = 0; offset < signatureLength; offset += 1) {
      if (tokens[candidate + offset] !== tokens[offset]) {
        signatureMatches = false;
        break;
      }
    }
    if (!signatureMatches || tokens.length < candidate * 2) {
      continue;
    }

    let mismatches = 0;
    const allowedMismatches = 0;
    for (let index = candidate; index < tokens.length; index += 1) {
      if (tokens[index] !== tokens[(index - candidate) % candidate]) {
        mismatches += 1;
        if (mismatches > allowedMismatches) {
          break;
        }
      }
    }
    if (mismatches <= allowedMismatches) {
      return transcript.slice(0, matches[candidate].index).trim();
    }
  }

  return transcript;
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
  const lines = markdown.split(/\r?\n/);
  const transcriptIndex = lines.findIndex((line) => line.trim() === '## Transcript');
  const analysisRegion = transcriptIndex === -1 ? markdown : lines.slice(0, transcriptIndex).join('\n');
  const topline = extractSection(analysisRegion, 'AI Analysis');
  const nextSteps = extractListItems(extractSection(analysisRegion, 'Next Steps'));

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

function normalizeHttpsYouTubeUrl(value: unknown) {
  const normalized = normalizeYouTubeUrl(value);
  if (new URL(normalized).protocol !== 'https:') {
    throw new Error('Video digest requests require an HTTPS YouTube URL.');
  }
  return normalized;
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
    const note = this.writeUniqueMarkdownNote(
      folderPath,
      `${formatDateSlug(created)}-${slugify(normalizedTitle)}`,
      (noteId) => {
        const candidate: FluxNoteSummary = {
          id: noteId,
          title: normalizedTitle,
          source: 'text',
          created: created.toISOString(),
          folder: normalizedFolder,
          transcript: content.trim(),
          transcriptPreview: previewTranscript(content.trim())
        };
        return { note: candidate, markdown: createMarkdownNote(candidate, content) };
      }
    );
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
    const transcript = removeRepeatedTranscriptBlocks(result.transcript);
    if (!transcript) {
      throw new Error(`Could not fetch YouTube captions for ${url}. The transcript was empty.`);
    }

    const folderPath = this.resolveLibraryPath(transcriptNotesFolder);
    this.ensureLibrary();
    mkdirSync(folderPath, { recursive: true });
    const created = new Date();
    const title = 'YouTube transcript';
    const note = this.writeUniqueMarkdownNote(
      folderPath,
      `${formatDateSlug(created)}-${slugify(title)}`,
      (noteId) => {
        const candidate: FluxNoteSummary = {
          id: noteId,
          title,
          source: 'youtube',
          created: created.toISOString(),
          folder: transcriptNotesFolder,
          url,
          transcript,
          transcriptPreview: previewTranscript(transcript)
        };
        return { note: candidate, markdown: createMarkdownNote(candidate, transcript) };
      }
    );
    return { note, library: this.listLibrary() };
  }

  createFolder(name: string): FluxFolderMutationResult {
    const folder = sanitizeFolderName(name);
    this.ensureLibrary();
    mkdirSync(this.resolveLibraryPath(folder), { recursive: true });
    return { folder, library: this.listLibrary() };
  }

  moveNote({ noteId, folder: currentFolder }: FluxNoteLocator, targetFolder: string): FluxLibrarySnapshot {
    const normalizedNoteId = normalizeNoteId(noteId);
    const normalizedCurrentFolder = sanitizeFolderName(currentFolder);
    const folder = sanitizeFolderName(targetFolder);
    const dataDir = this.ensureLibrary();
    const targetDir = this.resolveLibraryPath(folder);
    mkdirSync(targetDir, { recursive: true });

    const current = this.listNoteRecords(dataDir).find(
      (note) => note.id === normalizedNoteId && note.folder === normalizedCurrentFolder
    );
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
    if (items.length > fluxWorkingListItemLimit) {
      throw new Error(`Working list cannot exceed ${fluxWorkingListItemLimit} items.`);
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

  readCodexTaskTarget(): FluxCodexTaskReference | null {
    this.ensureLibrary();
    const targetPath = this.resolveLibraryPath('.flux', 'codex-task.json');
    if (!existsSync(targetPath)) {
      return null;
    }
    return normalizeBoundTask(JSON.parse(readFileSync(targetPath, 'utf8')) as unknown);
  }

  saveCodexTaskTarget(taskId: string, taskName?: string): FluxCodexTaskReference {
    const normalizedTaskId = normalizeTaskId(taskId);
    const normalizedTaskName = taskName
      ? normalizeTitle(taskName, 'Codex task name is invalid.').slice(0, 160)
      : undefined;
    const existing = this.readCodexTaskTarget();
    if (
      existing?.taskId === normalizedTaskId &&
      (normalizedTaskName === undefined || existing.taskName === normalizedTaskName)
    ) {
      return existing;
    }
    const target: FluxCodexTaskReference = {
      taskId: normalizedTaskId,
      ...(normalizedTaskName ? { taskName: normalizedTaskName } : {}),
      boundAt: new Date().toISOString()
    };
    this.writeJsonAtomically(this.resolveLibraryPath('.flux', 'codex-task.json'), 'codex-task', target);
    return target;
  }

  listVideoHandoffs(taskId?: string): FluxVideoHandoff[] {
    this.ensureLibrary();
    const normalizedTaskId = taskId === undefined ? undefined : normalizeTaskId(taskId);
    const handoffDir = this.resolveLibraryPath('.flux', 'video-handoffs');
    return readdirSync(handoffDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && /^[a-f0-9-]{36}\.json$/iu.test(entry.name))
      .map((entry) => this.readVideoHandoff(entry.name.slice(0, -5)))
      .filter((handoff) => normalizedTaskId === undefined || handoff.targetTask.taskId === normalizedTaskId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  readLatestVideoHandoff(taskId?: string): FluxVideoHandoff | null {
    const selectedTaskId = taskId ?? this.readCodexTaskTarget()?.taskId;
    if (!selectedTaskId) {
      return null;
    }
    return this.listVideoHandoffs(selectedTaskId)[0] ?? null;
  }

  createVideoHandoff({ expectedTaskId, sourceNote }: FluxCreateVideoHandoffPayload): FluxVideoHandoff {
    const normalizedExpectedTaskId = normalizeTaskId(expectedTaskId);
    const targetTask = this.readCodexTaskTarget();
    if (!targetTask) {
      throw new Error('Connect Flux to a Codex task before queueing a handoff.');
    }
    if (targetTask.taskId !== normalizedExpectedTaskId) {
      throw new Error('The connected Codex task changed. Refresh Flux before queueing this handoff.');
    }
    const note = this.readNote(sourceNote).note;
    if (note.source !== 'youtube' || !note.url || !note.transcript.trim()) {
      throw new Error('Generate a YouTube transcript before queueing a handoff.');
    }

    const now = new Date().toISOString();
    const generated: FluxVideoHandoff = {
      handoffId: randomUUID(),
      sourceUrl: normalizeHttpsYouTubeUrl(note.url),
      capturedAt: normalizeTimestamp(note.created, 'Transcript capture timestamp'),
      createdAt: now,
      updatedAt: now,
      state: 'generated',
      rawTranscript: normalizeBoundedText(note.transcript, 'Raw transcript', maxTranscriptCharacters),
      sourceNote: { noteId: note.id, folder: note.folder, title: note.title },
      targetTask
    };
    this.writeVideoHandoff(generated, true);
    return this.queueGeneratedVideoHandoff(generated);
  }

  claimVideoHandoff({ handoffId, taskId }: FluxClaimVideoHandoffPayload): FluxVideoHandoff {
    const normalizedTaskId = normalizeTaskId(taskId);
    const selected = this.readVideoHandoff(normalizeHandoffId(handoffId));
    if (selected.targetTask.taskId !== normalizedTaskId) {
      throw new Error('That Flux handoff targets a different Codex task.');
    }
    if (selected.state === 'claimed' || selected.state === 'analysis_ready') {
      return selected;
    }
    if (selected.state !== 'queued') {
      throw new Error(`Flux handoff ${selected.handoffId} cannot be claimed from ${selected.state}.`);
    }

    const claimPath = this.resolveLibraryPath('.flux', 'video-handoffs', `${selected.handoffId}.claim`);
    const publishedClaim = this.publishExclusiveMarker(
      claimPath,
      `${selected.handoffId}.claim`,
      `${normalizedTaskId}\n`
    );
    if (!publishedClaim) {
      const owner = readFileSync(claimPath, 'utf8').trim();
      if (owner !== normalizedTaskId) {
        throw new Error('That Flux handoff was claimed by a different Codex task.');
      }
    }

    const claimedAt = new Date().toISOString();
    const claimed: FluxVideoHandoff = {
      ...selected,
      state: 'claimed',
      claimedAt,
      updatedAt: claimedAt
    };
    this.writeVideoHandoff(claimed);
    return claimed;
  }

  completeVideoHandoff({
    handoffId,
    taskId,
    analysisResult
  }: FluxCompleteVideoHandoffPayload): FluxVideoHandoff {
    return this.finishVideoHandoff(handoffId, taskId, {
      state: 'analysis_ready',
      analysisResult: normalizeBoundedText(analysisResult, 'Flux analysis result', maxAnalysisCharacters)
    });
  }

  failVideoHandoff({ handoffId, taskId, failureMessage }: FluxFailVideoHandoffPayload): FluxVideoHandoff {
    return this.finishVideoHandoff(handoffId, taskId, {
      state: 'failed',
      failureMessage: normalizeBoundedText(failureMessage, 'Flux failure message', 2_000)
    });
  }

  private finishVideoHandoff(
    handoffId: string,
    taskId: string,
    outcome:
      | { state: 'analysis_ready'; analysisResult: string }
      | { state: 'failed'; failureMessage: string }
  ) {
    const normalizedTaskId = normalizeTaskId(taskId);
    const normalizedHandoffId = normalizeHandoffId(handoffId);
    let handoff = this.readVideoHandoff(normalizedHandoffId);
    if (handoff.targetTask.taskId !== normalizedTaskId) {
      throw new Error('That Flux handoff targets a different Codex task.');
    }
    if (handoff.state === 'analysis_ready' || handoff.state === 'failed') {
      return handoff;
    }
    if (handoff.state !== 'claimed') {
      throw new Error(`Flux handoff ${handoff.handoffId} must be claimed before completion.`);
    }

    const claimPath = this.resolveLibraryPath('.flux', 'video-handoffs', `${handoff.handoffId}.claim`);
    if (!existsSync(claimPath) || readFileSync(claimPath, 'utf8').trim() !== normalizedTaskId) {
      throw new Error('Flux could not verify the claiming Codex task.');
    }

    const terminalPath = this.resolveLibraryPath(
      '.flux',
      'video-handoffs',
      `${handoff.handoffId}.terminal.json`
    );
    const requestedTerminal = {
      taskId: normalizedTaskId,
      completedAt: new Date().toISOString(),
      ...outcome
    };
    let terminal: typeof requestedTerminal;
    const publishedTerminal = this.publishExclusiveMarker(
      terminalPath,
      `${handoff.handoffId}.terminal`,
      `${JSON.stringify(requestedTerminal, null, 2)}\n`
    );
    if (publishedTerminal) {
      terminal = requestedTerminal;
    } else {
      const parsed = JSON.parse(readFileSync(terminalPath, 'utf8')) as Record<string, unknown>;
      if (normalizeTaskId(parsed.taskId) !== normalizedTaskId) {
        throw new Error('Flux terminal transition belongs to a different Codex task.');
      }
      const completedAt = normalizeTimestamp(parsed.completedAt, 'Completion timestamp');
      terminal = parsed.state === 'analysis_ready'
        ? {
            taskId: normalizedTaskId,
            completedAt,
            state: 'analysis_ready',
            analysisResult: normalizeBoundedText(
              parsed.analysisResult,
              'Flux analysis result',
              maxAnalysisCharacters
            )
          }
        : parsed.state === 'failed'
          ? {
              taskId: normalizedTaskId,
              completedAt,
              state: 'failed',
              failureMessage: normalizeBoundedText(parsed.failureMessage, 'Flux failure message', 2_000)
            }
          : (() => {
              throw new Error('Flux terminal transition is invalid.');
            })();
    }

    handoff = this.readVideoHandoff(normalizedHandoffId);
    if (handoff.state === 'analysis_ready' || handoff.state === 'failed') {
      return handoff;
    }
    if (handoff.state !== 'claimed') {
      throw new Error(`Flux handoff ${handoff.handoffId} must be claimed before completion.`);
    }

    const completed: FluxVideoHandoff = {
      ...handoff,
      ...(terminal.state === 'analysis_ready'
        ? { state: terminal.state, analysisResult: terminal.analysisResult }
        : { state: terminal.state, failureMessage: terminal.failureMessage }),
      completedAt: terminal.completedAt,
      updatedAt: terminal.completedAt
    };
    this.writeVideoHandoff(completed);
    return completed;
  }

  private readVideoHandoff(handoffId: string): FluxVideoHandoff {
    const normalizedId = normalizeHandoffId(handoffId);
    const handoffPath = this.resolveLibraryPath('.flux', 'video-handoffs', `${normalizedId}.json`);
    if (!existsSync(handoffPath)) {
      throw new Error(`Flux handoff ${normalizedId} does not exist.`);
    }

    const parsed = JSON.parse(readFileSync(handoffPath, 'utf8')) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Flux video handoff is invalid.');
    }
    const value = parsed as Record<string, unknown>;
    if (typeof value.state !== 'string' || !videoHandoffStates.has(value.state as FluxVideoHandoffState)) {
      throw new Error('Flux video handoff state is invalid.');
    }
    if (!value.sourceNote || typeof value.sourceNote !== 'object' || Array.isArray(value.sourceNote)) {
      throw new Error('Flux video handoff source note is invalid.');
    }
    const sourceNote = value.sourceNote as Record<string, unknown>;
    const queuedAt = value.queuedAt === undefined ? undefined : normalizeTimestamp(value.queuedAt, 'Queued timestamp');
    const claimedAt =
      value.claimedAt === undefined ? undefined : normalizeTimestamp(value.claimedAt, 'Claimed timestamp');
    const completedAt =
      value.completedAt === undefined ? undefined : normalizeTimestamp(value.completedAt, 'Completion timestamp');
    const analysisResult =
      value.analysisResult === undefined
        ? undefined
        : normalizeBoundedText(value.analysisResult, 'Flux analysis result', maxAnalysisCharacters);
    const failureMessage =
      value.failureMessage === undefined
        ? undefined
        : normalizeBoundedText(value.failureMessage, 'Flux failure message', 2_000);

    const normalized: FluxVideoHandoff = {
      handoffId: normalizeHandoffId(value.handoffId),
      sourceUrl: normalizeHttpsYouTubeUrl(value.sourceUrl),
      capturedAt: normalizeTimestamp(value.capturedAt, 'Transcript capture timestamp'),
      createdAt: normalizeTimestamp(value.createdAt, 'Handoff creation timestamp'),
      updatedAt: normalizeTimestamp(value.updatedAt, 'Handoff update timestamp'),
      ...(queuedAt ? { queuedAt } : {}),
      ...(claimedAt ? { claimedAt } : {}),
      ...(completedAt ? { completedAt } : {}),
      state: value.state as FluxVideoHandoffState,
      rawTranscript: normalizeBoundedText(value.rawTranscript, 'Raw transcript', maxTranscriptCharacters),
      sourceNote: {
        noteId: normalizeNoteId(sourceNote.noteId),
        folder: sanitizeFolderName(String(sourceNote.folder || '')),
        title: normalizeTitle(sourceNote.title, 'Flux video handoff source title is invalid.')
      },
      targetTask: normalizeBoundTask(value.targetTask),
      ...(analysisResult ? { analysisResult } : {}),
      ...(failureMessage ? { failureMessage } : {})
    };
    return this.queueGeneratedVideoHandoff(normalized);
  }

  private queueGeneratedVideoHandoff(handoff: FluxVideoHandoff): FluxVideoHandoff {
    if (handoff.state !== 'generated') {
      return handoff;
    }
    const queuedAt = new Date().toISOString();
    const queued: FluxVideoHandoff = {
      ...handoff,
      state: 'queued',
      queuedAt,
      updatedAt: queuedAt
    };
    this.writeVideoHandoff(queued);
    return queued;
  }

  private writeVideoHandoff(handoff: FluxVideoHandoff, createOnly = false) {
    const handoffPath = this.resolveLibraryPath('.flux', 'video-handoffs', `${handoff.handoffId}.json`);
    if (createOnly) {
      writeFileSync(handoffPath, `${JSON.stringify(handoff, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
      return;
    }
    this.writeJsonAtomically(handoffPath, `video-handoff-${handoff.handoffId}`, handoff);
  }

  private publishExclusiveMarker(filePath: string, prefix: string, content: string) {
    const tempPath = this.resolveLibraryPath(
      '.flux',
      'video-handoffs',
      `${prefix}.${randomUUID()}.tmp`
    );
    writeFileSync(tempPath, content, { encoding: 'utf8', flag: 'wx' });
    try {
      linkSync(tempPath, filePath);
      return true;
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
      if (code !== 'EEXIST') {
        throw error;
      }
      return false;
    } finally {
      if (existsSync(tempPath)) {
        unlinkSync(tempPath);
      }
    }
  }

  private writeJsonAtomically(filePath: string, prefix: string, value: unknown) {
    this.ensureLibrary();
    const tempPath = this.resolveLibraryPath('.flux', `${prefix}.${randomUUID()}.tmp`);
    writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
    renameSync(tempPath, filePath);
  }

  private ensureLibrary() {
    mkdirSync(this.dataDir, { recursive: true });
    mkdirSync(this.resolveLibraryPath('Inbox'), { recursive: true });
    mkdirSync(this.resolveLibraryPath('.flux', 'audio'), { recursive: true });
    mkdirSync(this.resolveLibraryPath('.flux', 'video-handoffs'), { recursive: true });
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

  private writeUniqueMarkdownNote(
    folderPath: string,
    baseNoteId: string,
    prepare: (noteId: string) => { note: FluxNoteSummary; markdown: string }
  ) {
    let suffix = 1;

    while (true) {
      const noteId = suffix === 1 ? baseNoteId : `${baseNoteId}-${suffix}`;
      const notePath = path.join(folderPath, `${noteId}.md`);
      const prepared = prepare(noteId);
      try {
        writeFileSync(notePath, prepared.markdown, { encoding: 'utf8', flag: 'wx' });
        return prepared.note;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
          throw error;
        }
        suffix += 1;
      }
    }
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
    const note = this.writeUniqueMarkdownNote(
      folderPath,
      `${formatDateSlug(created)}-${slugify(title)}`,
      (noteId) => {
        const candidate: FluxNoteSummary = {
          id: noteId,
          title,
          source: 'voice',
          created: created.toISOString(),
          folder: 'Inbox',
          analysis,
          transcript,
          transcriptPreview: previewTranscript(transcript)
        };
        return { note: candidate, markdown: createMarkdownNote(candidate, transcript) };
      }
    );
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
      candidate.items.length > fluxWorkingListItemLimit ||
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
