import { app, BrowserWindow, ipcMain, screen } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';

type WindowBounds = {
  width: number;
  height: number;
  x?: number;
  y?: number;
};

type FluxSettings = {
  windowBounds?: WindowBounds;
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultBounds: WindowBounds = { width: 980, height: 660 };
const dataDir = path.join(os.homedir(), 'Flux');
const settingsDir = path.join(dataDir, '.flux');
const settingsPath = path.join(settingsDir, 'settings.json');

function readSettings(): FluxSettings {
  try {
    return JSON.parse(readFileSync(settingsPath, 'utf8')) as FluxSettings;
  } catch {
    return {};
  }
}

function writeSettings(settings: FluxSettings) {
  mkdirSync(settingsDir, { recursive: true });
  writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);
}

function safeBounds(bounds?: WindowBounds): WindowBounds {
  if (!bounds) {
    return defaultBounds;
  }

  const displays = screen.getAllDisplays().map((display) => display.workArea);
  const isVisible =
    bounds.x === undefined ||
    bounds.y === undefined ||
    displays.some(
      (area) =>
        bounds.x! < area.x + area.width &&
        bounds.x! + bounds.width > area.x &&
        bounds.y! < area.y + area.height &&
        bounds.y! + bounds.height > area.y
    );

  return isVisible ? bounds : defaultBounds;
}

function createWindow() {
  const settings = readSettings();
  const bounds = safeBounds(settings.windowBounds);

  const mainWindow = new BrowserWindow({
    ...bounds,
    minWidth: 420,
    minHeight: 420,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: true,
    hasShadow: false,
    title: 'Flux',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.on('close', () => {
    writeSettings({
      ...readSettings(),
      windowBounds: mainWindow.getBounds()
    });
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    void mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    void mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}

app.whenReady().then(() => {
  ipcMain.handle('window:minimize', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize();
  });

  ipcMain.handle('window:close', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close();
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
