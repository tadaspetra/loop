import path from 'node:path';

import type {
  BrowserWindow as ElectronBrowserWindow,
  BrowserWindowConstructorOptions,
  Event
} from 'electron';

import type { CloseGuard } from './close-guard';

/**
 * Sent to the renderer when a window close was intercepted because a
 * recording is active. The renderer prompts, stops/finalizes, and then calls
 * `app:confirm-close` to trigger the real close.
 */
export const CLOSE_REQUESTED_CHANNEL = 'app:close-requested';

interface ConsoleMessagePayload {
  event: Event;
  level: number;
  message: string;
  line: number;
  sourceId: string;
}

export type BrowserWindowConstructor = new (
  options: BrowserWindowConstructorOptions
) => ElectronBrowserWindow;

export function createWindow({
  BrowserWindow,
  onConsoleMessage,
  appRootDir = path.join(__dirname, '..', '..'),
  closeGuard
}: {
  BrowserWindow: BrowserWindowConstructor;
  onConsoleMessage?: (payload: ConsoleMessagePayload) => void;
  appRootDir?: string;
  closeGuard?: CloseGuard;
}): ElectronBrowserWindow {
  const win = new BrowserWindow({
    width: 960,
    height: 800,
    webPreferences: {
      preload: path.join(appRootDir, 'preload.js'),
      // Make security defaults explicit so they cannot silently regress if
      // Electron changes them in a future major version.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false
    }
  });

  win.setContentProtection(true);
  win.webContents.on('console-message', (event, level, message, line, sourceId) => {
    if (typeof onConsoleMessage === 'function') {
      onConsoleMessage({ event, level, message, line, sourceId });
      return;
    }
    console.log(`[renderer:${level}] ${message} (${sourceId}:${line})`);
  });

  // Prevent the renderer from opening new browser windows. All project/recent
  // interactions go through IPC, so any window.open call is an unexpected
  // attempt to load external content.
  if (typeof win.webContents.setWindowOpenHandler === 'function') {
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  }

  // Block in-page navigations away from the packaged index.html. If a link
  // slips through we don't silently swap the entire app surface for an
  // external page.
  win.webContents.on('will-navigate', (event, navigationUrl) => {
    try {
      const parsed = new URL(navigationUrl);
      if (parsed.protocol !== 'file:') {
        event.preventDefault();
      }
    } catch {
      event.preventDefault();
    }
  });

  // Quit guard: while a recording is active (renderer keeps the guard
  // informed via 'recording:set-active'), intercept the close and ask the
  // renderer to stop + finalize first. The renderer confirms the real close
  // via 'app:confirm-close', which arms a one-shot bypass on the guard.
  if (closeGuard) {
    win.on('close', (event) => {
      if (closeGuard.handleCloseRequest() !== 'prevent') return;

      // If the renderer is already gone there is nobody left to finalize and
      // confirm; the streamed bytes are safe in the .part files (recovered on
      // next launch), so let the close proceed instead of wedging the window.
      if (win.webContents.isDestroyed()) return;

      event.preventDefault();
      try {
        win.webContents.send(CLOSE_REQUESTED_CHANNEL);
      } catch (error) {
        console.warn('close-requested notification failed; closing anyway:', error);
        closeGuard.confirmClose();
        win.close();
      }
    });
  }

  win.loadFile(path.join(appRootDir, 'index.html'));
  return win;
}
