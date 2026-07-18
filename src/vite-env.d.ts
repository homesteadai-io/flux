/// <reference types="vite/client" />

interface FluxWindowApi {
  minimize: () => void;
  close: () => void;
}

interface FluxFolder {
  name: string;
  count: number;
}

interface FluxAnalysis {
  model: string;
  topline: string;
  nextSteps: string[];
}

interface FluxNoteSummary {
  id: string;
  title: string;
  source: 'text' | 'voice' | 'youtube';
  created: string;
  folder: string;
  url?: string;
  analysis?: FluxAnalysis;
  transcript: string;
  transcriptPreview: string;
}

interface FluxLibrarySnapshot {
  folders: FluxFolder[];
  notes: FluxNoteSummary[];
}

interface FluxCaptureResult {
  note: FluxNoteSummary;
  library: FluxLibrarySnapshot;
}

interface FluxCodexTaskReference {
  taskId: string;
  taskName?: string;
  boundAt: string;
}

type FluxVideoHandoffState = 'generated' | 'queued' | 'claimed' | 'analysis_ready' | 'failed';

interface FluxVideoHandoff {
  handoffId: string;
  sourceUrl: string;
  capturedAt: string;
  createdAt: string;
  updatedAt: string;
  queuedAt?: string;
  claimedAt?: string;
  completedAt?: string;
  state: FluxVideoHandoffState;
  rawTranscript: string;
  sourceNote: { noteId: string; folder: string; title: string };
  targetTask: FluxCodexTaskReference;
  analysisResult?: string;
  failureMessage?: string;
}

type FluxSaveEnvResult =
  | { canceled: true }
  | { canceled: false; filePath: string; directory: string; overwritten: boolean };

interface FluxCopyMarkdownResult {
  noteId: string;
  bytes: number;
}

type FluxExportMarkdownResult =
  | { canceled: true }
  | { canceled: false; filePath: string; directory: string; overwritten: boolean };

interface FluxListMarkdownResult {
  filePath: string;
  directory: string;
}

interface FluxListCopyMarkdownResult {
  bytes: number;
}

interface FluxScreenshot {
  id: string;
  filePath: string;
  fileName: string;
  created: string;
  scope: 'desktop_capture' | 'flux_page_capture' | 'uploaded_image';
  dataUrl: string;
  width: number;
  height: number;
}

interface FluxLibraryApi {
  list: () => Promise<FluxLibrarySnapshot>;
  createFolder: (name: string) => Promise<{ folder: string; library: FluxLibrarySnapshot }>;
  moveNote: (noteId: string, folder: string, targetFolder: string) => Promise<FluxLibrarySnapshot>;
  saveRecording: (payload: { audioData: ArrayBuffer; mimeType: string }) => Promise<FluxCaptureResult>;
  saveYouTubeUrl: (payload: { url: string }) => Promise<FluxCaptureResult>;
  readCodexTaskTarget: () => Promise<FluxCodexTaskReference | null>;
  readLatestVideoHandoff: (taskId: string) => Promise<FluxVideoHandoff | null>;
  createVideoHandoff: (payload: {
    expectedTaskId: string;
    sourceNote: { noteId: string; folder: string };
  }) => Promise<FluxVideoHandoff>;
  saveEnvLocal: (payload: { content: string }) => Promise<FluxSaveEnvResult>;
  copyMarkdown: (payload: { noteId: string; folder: string }) => Promise<FluxCopyMarkdownResult>;
  exportMarkdown: (payload: { noteId: string; folder: string }) => Promise<FluxExportMarkdownResult>;
  copyListMarkdown: (payload: { title: string; markdown: string }) => Promise<FluxListCopyMarkdownResult>;
  exportListMarkdown: (payload: { title: string; markdown: string }) => Promise<FluxListMarkdownResult>;
  copyTextMarkdown: (payload: { title: string; markdown: string }) => Promise<FluxListCopyMarkdownResult>;
  exportTextMarkdown: (payload: { title: string; markdown: string }) => Promise<FluxListMarkdownResult>;
  listScreenshots: () => Promise<FluxScreenshot[]>;
  captureScreenshot: () => Promise<{ screenshot: FluxScreenshot; screenshots: FluxScreenshot[] }>;
  copyScreenshot: (payload: { filePath: string }) => Promise<FluxScreenshot>;
  saveScreenshot: (payload: { filePath: string }) => Promise<FluxExportMarkdownResult>;
  deleteScreenshot: (payload: { filePath: string }) => Promise<FluxScreenshot[]>;
  openScreenshotsFolder: () => Promise<{ directory: string }>;
  readWorkingList: () => Promise<{ title: string; items: string[] }>;
  saveWorkingList: (payload: { title: string; items: string[] }) => Promise<{ title: string; items: string[] }>;
  readCaptureDraft: () => Promise<{ text: string }>;
  saveCaptureDraft: (payload: { text: string }) => Promise<{ text: string }>;
}

interface Window {
  fluxWindow?: FluxWindowApi;
  fluxLibrary?: FluxLibraryApi;
}
