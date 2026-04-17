import 'dotenv/config';

import { app, BrowserWindow, desktopCapturer, dialog, ipcMain, session, shell } from 'electron';

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

registerIpcHandlers({
  ipcMain,
  app,
  dialog,
  desktopCapturer,
  shell,
  getWindow: () => win,
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
    onConsoleMessage: ({ level, message, line, sourceId }) => {
      console.log(`[renderer:${level}] ${message} (${sourceId}:${line})`);
    }
  });
  win.on('closed', () => {
    win = null;
  });
}

app.whenReady().then(() => {
  registerDisplayMediaHandler({
    session: session.defaultSession,
    desktopCapturer
  });
  createMainWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
});
