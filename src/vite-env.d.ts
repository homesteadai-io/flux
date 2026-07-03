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
  source: 'voice' | 'youtube';
  created: string;
  folder: string;
  url?: string;
  analysis?: FluxAnalysis;
  transcriptPreview: string;
}

interface FluxChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  created: string;
}

interface FluxLibrarySnapshot {
  folders: FluxFolder[];
  notes: FluxNoteSummary[];
}

interface FluxCaptureResult {
  note: FluxNoteSummary;
  library: FluxLibrarySnapshot;
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

interface FluxNoteChatResult {
  messages: FluxChatMessage[];
}

interface FluxLibraryApi {
  list: () => Promise<FluxLibrarySnapshot>;
  createFolder: (name: string) => Promise<{ folder: string; library: FluxLibrarySnapshot }>;
  moveNote: (noteId: string, sourceFolder: string, targetFolder: string) => Promise<FluxLibrarySnapshot>;
  saveRecording: (payload: { audioData: ArrayBuffer; mimeType: string }) => Promise<FluxCaptureResult>;
  saveYouTubeUrl: (payload: { url: string }) => Promise<FluxCaptureResult>;
  saveEnvLocal: (payload: { content: string }) => Promise<FluxSaveEnvResult>;
  copyMarkdown: (payload: { noteId: string; folder: string }) => Promise<FluxCopyMarkdownResult>;
  exportMarkdown: (payload: { noteId: string; folder: string }) => Promise<FluxExportMarkdownResult>;
  getNoteChat: (payload: { noteId: string; folder: string }) => Promise<FluxNoteChatResult>;
  sendNoteChat: (payload: { noteId: string; folder: string; message: string }) => Promise<FluxNoteChatResult>;
}

interface Window {
  fluxWindow: FluxWindowApi;
  fluxLibrary: FluxLibraryApi;
}
