import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('fluxWindow', {
  minimize: () => ipcRenderer.invoke('window:minimize'),
  close: () => ipcRenderer.invoke('window:close')
});
