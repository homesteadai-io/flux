const apiBase = '/api';

async function requestJson<T>(pathname: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBase}${pathname}`, {
    ...init,
    headers: {
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers
    }
  });
  const value = (await response.json()) as T & { error?: string };
  if (!response.ok) {
    throw new Error(value.error || `Flux request failed (${response.status}).`);
  }
  return value;
}

function bytes(value: string) {
  return new TextEncoder().encode(value).byteLength;
}

async function copyText(value: string) {
  if (!navigator.clipboard?.writeText) {
    throw new Error('Clipboard access is unavailable in this browser.');
  }
  await navigator.clipboard.writeText(value);
}

function safeFileName(title: string) {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return `${slug || 'flux-note'}.md`;
}

function downloadMarkdown(title: string, markdown: string): FluxListMarkdownResult {
  const fileName = safeFileName(title);
  const objectUrl = URL.createObjectURL(new Blob([markdown], { type: 'text/markdown;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = fileName;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
  return { filePath: fileName, directory: 'Downloads' };
}

function arrayBufferToBase64(value: ArrayBuffer) {
  const input = new Uint8Array(value);
  let binary = '';
  for (let offset = 0; offset < input.length; offset += 0x8000) {
    binary += String.fromCharCode(...input.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

async function readMarkdown(payload: { noteId: string; folder: string }) {
  const query = new URLSearchParams(payload).toString();
  return requestJson<{ markdown: string; note: FluxNoteSummary }>(`/notes/read?${query}`);
}

const browserLibrary: FluxLibraryApi = {
  list: () => requestJson('/library'),
  createFolder: (name) =>
    requestJson('/folders', { method: 'POST', body: JSON.stringify({ name }) }),
  moveNote: (noteId, targetFolder) =>
    requestJson('/notes/move', {
      method: 'POST',
      body: JSON.stringify({ noteId, targetFolder })
    }),
  saveRecording: ({ audioData, mimeType }) =>
    requestJson('/recordings', {
      method: 'POST',
      body: JSON.stringify({ audioBase64: arrayBufferToBase64(audioData), mimeType })
    }),
  saveYouTubeUrl: ({ url }) =>
    requestJson('/youtube', { method: 'POST', body: JSON.stringify({ url }) }),
  saveEnvLocal: async () => ({ canceled: true }),
  copyMarkdown: async (payload) => {
    const document = await readMarkdown(payload);
    await copyText(document.markdown);
    return { noteId: payload.noteId, bytes: bytes(document.markdown) };
  },
  exportMarkdown: async (payload) => {
    const document = await readMarkdown(payload);
    const result = downloadMarkdown(document.note.title, document.markdown);
    return { canceled: false, ...result, overwritten: false };
  },
  copyListMarkdown: async ({ markdown }) => {
    await copyText(markdown);
    return { bytes: bytes(markdown) };
  },
  exportListMarkdown: async ({ title, markdown }) => downloadMarkdown(title, markdown),
  copyTextMarkdown: async ({ markdown }) => {
    await copyText(markdown);
    return { bytes: bytes(markdown) };
  },
  exportTextMarkdown: async ({ title, markdown }) => downloadMarkdown(title, markdown),
  listScreenshots: async () => [],
  captureScreenshot: async () => {
    throw new Error('Desktop capture is available in the Flux desktop app.');
  },
  copyScreenshot: async () => {
    throw new Error('Image copy is available in the Flux desktop app.');
  },
  saveScreenshot: async () => ({ canceled: true }),
  deleteScreenshot: async () => [],
  openScreenshotsFolder: async () => {
    throw new Error('Open folder is available in the Flux desktop app.');
  },
  readWorkingList: () => requestJson('/working-list'),
  saveWorkingList: (payload) =>
    requestJson('/working-list', { method: 'PUT', body: JSON.stringify(payload) }),
  readCaptureDraft: () => requestJson('/capture-draft'),
  saveCaptureDraft: (payload) =>
    requestJson('/capture-draft', { method: 'PUT', body: JSON.stringify(payload) })
};

export function getFluxLibrary() {
  return window.fluxLibrary ?? browserLibrary;
}

export function isFluxDesktop() {
  return Boolean(window.fluxLibrary);
}
