require('dotenv').config();
require('electron-reload')(__dirname);

const { app, BrowserWindow, ipcMain, dialog, desktopCapturer, shell, screen } = require('electron');

const { createWindow } = require('./main/app/create-window');
const { registerIpcHandlers } = require('./main/ipc/register-handlers');
const { createProjectService } = require('./main/services/project-service');
const { renderComposite } = require('./main/services/render-service');
const { computeSections } = require('./main/services/sections-service');
const { getScribeToken } = require('./main/services/scribe-service');
const proxyService = require('./main/services/proxy-service');

let win = null;

const projectService = createProjectService({ app });

const { cleanupMouseTrailTimer } = registerIpcHandlers({
  ipcMain,
  app,
  dialog,
  desktopCapturer,
  shell,
  getWindow: () => win,
  screen,
  projectService,
  renderComposite,
  computeSections,
  getScribeToken,
  proxyService
});

// Defensive cleanup for stale timer state from a previous hot-reload
cleanupMouseTrailTimer();

app.on('before-quit', () => {
  cleanupMouseTrailTimer();
});

function createMainWindow() {
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
