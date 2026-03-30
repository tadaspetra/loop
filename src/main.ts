import 'dotenv/config';

import { app, BrowserWindow, desktopCapturer, dialog, ipcMain, shell } from 'electron';

import { createWindow } from './main/app/create-window';
import { registerIpcHandlers } from './main/ipc/register-handlers';
import { createProjectService } from './main/services/project-service';
import { renderComposite } from './main/services/render-service';
import { computeSections } from './main/services/sections-service';
import { getScribeToken } from './main/services/scribe-service';
import * as proxyService from './main/services/proxy-service';

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
  computeSections,
  getScribeToken,
  proxyService
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

app.whenReady().then(createMainWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
});
