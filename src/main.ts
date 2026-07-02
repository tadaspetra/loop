import 'dotenv/config';

import {
  app,
  BrowserWindow,
  desktopCapturer,
  dialog,
  ipcMain,
  session,
  shell,
  systemPreferences
} from 'electron';

import { createCloseGuard } from './main/app/close-guard';
import { createWindow } from './main/app/create-window';
import {
  registerDisplayMediaHandler,
  setPendingDisplayMediaSource
} from './main/app/display-media-handler';
import { registerIpcHandlers } from './main/ipc/register-handlers';
import { createProjectService } from './main/services/project-service';
import { renderComposite } from './main/services/render-service';
import { exportPremiereProject } from './main/services/premiere-export-service';
import { computeSections } from './main/services/sections-service';
import { generatePreview } from './main/services/preview-render-service';
import { getScribeToken } from './main/services/scribe-service';
import * as proxyService from './main/services/proxy-service';
import * as recordingService from './main/services/recording-service';

let win: BrowserWindow | null = null;

const projectService = createProjectService({ app });

// Quit guard: prevents closing the window mid-recording until the renderer
// stops/finalizes (or the user confirms the close anyway).
const closeGuard = createCloseGuard();

registerIpcHandlers({
  ipcMain,
  app,
  dialog,
  desktopCapturer,
  shell,
  systemPreferences,
  getWindow: () => win,
  closeGuard,
  projectService,
  renderComposite,
  exportPremiereProject,
  computeSections,
  generatePreview,
  getScribeToken,
  proxyService,
  recordingService,
  setPendingDisplayMediaSource
});

function createMainWindow(): void {
  win = createWindow({
    BrowserWindow,
    closeGuard,
    onConsoleMessage: ({ level, message, line, sourceId }) => {
      console.log(`[renderer:${level}] ${message} (${sourceId}:${line})`);
    }
  });
  win.on('closed', () => {
    win = null;
    // The renderer that owned the recording flag is gone; reset so a window
    // reopened via app 'activate' does not inherit a stale guard state.
    closeGuard.setRecordingActive(false);
  });
}

app.whenReady().then(() => {
  registerDisplayMediaHandler({
    session: session.defaultSession,
    desktopCapturer
  });
  createMainWindow();
});

app.on('before-quit', () => {
  // Shutdown safety: flush and close any recording fds still open so their
  // .part files survive intact on disk for orphan recovery on next launch.
  // Best-effort and synchronous; never throws (and must never block quit).
  try {
    recordingService.closeAllRecordingHandlesForShutdown();
  } catch (error) {
    console.warn('[recording] shutdown flush failed:', error);
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
});
