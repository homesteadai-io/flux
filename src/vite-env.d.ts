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

interface FluxVideoDigestRequest {
  url: string;
  requestedAt: string;
  sourceNote?: { noteId: string; folder: string; title: string };
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
  readVideoDigestRequest: () => Promise<FluxVideoDigestRequest | null>;
  saveVideoDigestRequest: (payload: {
    url: string;
    sourceNote?: { noteId: string; folder: string };
  }) => Promise<FluxVideoDigestRequest>;
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
