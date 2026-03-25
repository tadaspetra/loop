import path from 'node:path';

import type {
  BrowserWindow as ElectronBrowserWindow,
  BrowserWindowConstructorOptions,
  Event,
} from 'electron';

interface ConsoleMessagePayload {
  event: Event;
  level: number;
  message: string;
  line: number;
  sourceId: string;
}

type BrowserWindowConstructor = new (
  options: BrowserWindowConstructorOptions,
) => ElectronBrowserWindow;

export function createWindow({
  BrowserWindow,
  onConsoleMessage,
  appRootDir = path.join(__dirname, '..', '..'),
}: {
  BrowserWindow: BrowserWindowConstructor;
  onConsoleMessage?: (payload: ConsoleMessagePayload) => void;
  appRootDir?: string;
}): ElectronBrowserWindow {
  const win = new BrowserWindow({
    width: 960,
    height: 800,
    webPreferences: {
      preload: path.join(appRootDir, 'preload.js'),
    },
  });

  win.setContentProtection(true);
  win.webContents.on(
    'console-message',
    (event, level, message, line, sourceId) => {
      if (typeof onConsoleMessage === 'function') {
        onConsoleMessage({ event, level, message, line, sourceId });
        return;
      }
      console.log(`[renderer:${level}] ${message} (${sourceId}:${line})`);
    },
  );

  win.loadFile(path.join(appRootDir, 'index.html'));
  return win;
}
