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

interface FluxLibrarySnapshot {
  folders: FluxFolder[];
  notes: FluxNoteSummary[];
}

interface FluxCaptureResult {
  note: FluxNoteSummary;
  library: FluxLibrarySnapshot;
}

interface FluxLibraryApi {
  list: () => Promise<FluxLibrarySnapshot>;
  createFolder: (name: string) => Promise<{ folder: string; library: FluxLibrarySnapshot }>;
  moveNote: (noteId: string, targetFolder: string) => Promise<FluxLibrarySnapshot>;
  saveRecording: (payload: { audioData: ArrayBuffer; mimeType: string }) => Promise<FluxCaptureResult>;
  saveYouTubeUrl: (payload: { url: string }) => Promise<FluxCaptureResult>;
}

interface Window {
  fluxWindow: FluxWindowApi;
  fluxLibrary: FluxLibraryApi;
}
