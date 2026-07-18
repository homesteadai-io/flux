export type FluxNoteSource = 'text' | 'voice' | 'youtube';

export const fluxWorkingListItemLimit = 1_000;

export type FluxAnalysis = {
  model: string;
  topline: string;
  nextSteps: string[];
};

export type FluxFolder = {
  name: string;
  count: number;
};

export type FluxNoteSummary = {
  id: string;
  title: string;
  source: FluxNoteSource;
  created: string;
  folder: string;
  url?: string;
  analysis?: FluxAnalysis;
  transcript: string;
  transcriptPreview: string;
};

export type FluxLibrarySnapshot = {
  folders: FluxFolder[];
  notes: FluxNoteSummary[];
};

export type FluxNoteFilters = {
  folder?: string;
  source?: FluxNoteSource;
};

export type FluxNoteLocator = {
  noteId: string;
  folder: string;
};

export type FluxReadNoteResult = {
  note: FluxNoteSummary;
  markdown: string;
};

export type FluxCreateTextNotePayload = {
  title: string;
  content: string;
  folder?: string;
};

export type FluxSaveRecordingPayload = {
  audioData: ArrayBuffer | ArrayBufferView;
  mimeType?: string;
};

export type FluxSaveYouTubePayload = {
  url: string;
};

export type FluxCodexTaskReference = {
  taskId: string;
  taskName?: string;
  boundAt: string;
};

export type FluxVideoHandoffState = 'generated' | 'queued' | 'claimed' | 'analysis_ready' | 'failed';

export type FluxVideoHandoff = {
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
  sourceNote: FluxNoteLocator & { title: string };
  targetTask: FluxCodexTaskReference;
  analysisResult?: string;
  failureMessage?: string;
};

export type FluxCreateVideoHandoffPayload = {
  expectedTaskId: string;
  sourceNote: FluxNoteLocator;
};

export type FluxClaimVideoHandoffPayload = {
  handoffId: string;
  taskId: string;
};

export type FluxCompleteVideoHandoffPayload = {
  handoffId: string;
  taskId: string;
  analysisResult: string;
};

export type FluxFailVideoHandoffPayload = {
  handoffId: string;
  taskId: string;
  failureMessage: string;
};

export type FluxNoteMutationResult = {
  note: FluxNoteSummary;
  library: FluxLibrarySnapshot;
};

export type FluxFolderMutationResult = {
  folder: string;
  library: FluxLibrarySnapshot;
};

export type FluxWorkingList = {
  title: string;
  items: string[];
  updatedAt?: string;
};

export type FluxSaveWorkingListPayload = {
  title: string;
  items: string[];
};

export type FluxCaptureDraft = {
  text: string;
};

export type FluxSaveCaptureDraftPayload = {
  text: string;
};

export type FluxAnalyzedTranscript = FluxAnalysis & {
  title: string;
};

export type FluxAIProvider = {
  transcribeAudio(audioPath: string, mimeType: string): Promise<string>;
  analyzeTranscript(transcript: string): Promise<FluxAnalyzedTranscript>;
};

export type FluxAIProviderFactory = () => FluxAIProvider | Promise<FluxAIProvider>;

export type FluxTranscriptEngineResult =
  | { ok: true; transcript: string }
  | { ok: false; reason: string; message: string; detail?: string };

export type FluxTranscriptEngine = {
  getCleanTranscript(url: string): Promise<FluxTranscriptEngineResult>;
};

export type FluxCoreOptions = {
  dataDir?: string;
  aiProviderFactory?: FluxAIProviderFactory;
  transcriptEngine?: FluxTranscriptEngine;
};
