import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('fluxWindow', {
  minimize: () => ipcRenderer.invoke('window:minimize'),
  close: () => ipcRenderer.invoke('window:close')
});

contextBridge.exposeInMainWorld('fluxLibrary', {
  list: () => ipcRenderer.invoke('library:list'),
  createFolder: (name: string) => ipcRenderer.invoke('library:create-folder', { name }),
  moveNote: (noteId: string, folder: string, targetFolder: string) =>
    ipcRenderer.invoke('library:move-note', { noteId, folder, targetFolder }),
  saveRecording: (payload: { audioData: ArrayBuffer; mimeType: string }) =>
    ipcRenderer.invoke('capture:save-recording', payload),
  saveYouTubeUrl: (payload: { url: string }) => ipcRenderer.invoke('capture:save-youtube-url', payload),
  readCodexTaskTarget: () => ipcRenderer.invoke('codex-task:read'),
  readLatestVideoHandoff: (taskId: string) => ipcRenderer.invoke('video-handoff:latest', taskId),
  createVideoHandoff: (payload: {
    expectedTaskId: string;
    sourceNote: { noteId: string; folder: string };
  }) =>
    ipcRenderer.invoke('video-handoff:create', payload),
  saveEnvLocal: (payload: { content: string }) => ipcRenderer.invoke('capture:save-env-local', payload),
  copyMarkdown: (payload: { noteId: string; folder: string }) =>
    ipcRenderer.invoke('note:copy-markdown', payload),
  exportMarkdown: (payload: { noteId: string; folder: string }) =>
    ipcRenderer.invoke('note:export-markdown', payload),
  copyListMarkdown: (payload: { title: string; markdown: string }) =>
    ipcRenderer.invoke('list:copy-markdown', payload),
  exportListMarkdown: (payload: { title: string; markdown: string }) =>
    ipcRenderer.invoke('list:export-markdown', payload),
  copyTextMarkdown: (payload: { title: string; markdown: string }) =>
    ipcRenderer.invoke('text:copy-markdown', payload),
  exportTextMarkdown: (payload: { title: string; markdown: string }) =>
    ipcRenderer.invoke('text:export-markdown', payload),
  readWorkingList: () => ipcRenderer.invoke('working-list:read'),
  saveWorkingList: (payload: { title: string; items: string[] }) =>
    ipcRenderer.invoke('working-list:save', payload),
  readCaptureDraft: () => ipcRenderer.invoke('capture-draft:read'),
  saveCaptureDraft: (payload: { text: string }) =>
    ipcRenderer.invoke('capture-draft:save', payload),
  listScreenshots: () => ipcRenderer.invoke('screenshot:list'),
  captureScreenshot: () => ipcRenderer.invoke('screenshot:capture'),
  copyScreenshot: (payload: { filePath: string }) => ipcRenderer.invoke('screenshot:copy', payload),
  saveScreenshot: (payload: { filePath: string }) => ipcRenderer.invoke('screenshot:save', payload),
  deleteScreenshot: (payload: { filePath: string }) => ipcRenderer.invoke('screenshot:delete', payload),
  openScreenshotsFolder: () => ipcRenderer.invoke('screenshot:open-folder')
});
