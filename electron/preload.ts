import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('fluxWindow', {
  minimize: () => ipcRenderer.invoke('window:minimize'),
  close: () => ipcRenderer.invoke('window:close')
});

contextBridge.exposeInMainWorld('fluxLibrary', {
  list: () => ipcRenderer.invoke('library:list'),
  createFolder: (name: string) => ipcRenderer.invoke('library:create-folder', { name }),
  moveNote: (noteId: string, targetFolder: string) =>
    ipcRenderer.invoke('library:move-note', { noteId, targetFolder }),
  saveRecording: (payload: { audioData: ArrayBuffer; mimeType: string }) =>
    ipcRenderer.invoke('capture:save-recording', payload),
  saveYouTubeUrl: (payload: { url: string }) => ipcRenderer.invoke('capture:save-youtube-url', payload),
  saveEnvLocal: (payload: { content: string }) => ipcRenderer.invoke('capture:save-env-local', payload),
  copyMarkdown: (payload: { noteId: string; folder: string }) =>
    ipcRenderer.invoke('note:copy-markdown', payload),
  exportMarkdown: (payload: { noteId: string; folder: string }) =>
    ipcRenderer.invoke('note:export-markdown', payload)
});
