const path = require('path');

function registerIpcHandlers({
  ipcMain,
  app,
  dialog,
  desktopCapturer,
  shell,
  getWindow,
  projectService,
  renderComposite,
  computeSections,
  getScribeToken
}) {
  ipcMain.handle('set-content-protection', async (_event, enabled) => {
    const win = getWindow();
    if (!win || win.isDestroyed()) return false;
    win.setContentProtection(Boolean(enabled));
    return true;
  });

  ipcMain.handle('get-sources', async () => {
    try {
      const sources = await desktopCapturer.getSources({
        types: ['screen', 'window'],
        thumbnailSize: { width: 0, height: 0 }
      });
      return sources.map((source) => ({ id: source.id, name: source.name }));
    } catch (error) {
      console.error('desktopCapturer error:', error);
      return [];
    }
  });

  ipcMain.handle('pick-folder', async (_event, opts = {}) => {
    const win = getWindow();
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      title: typeof opts.title === 'string' && opts.title ? opts.title : 'Choose Folder',
      buttonLabel:
        typeof opts.buttonLabel === 'string' && opts.buttonLabel ? opts.buttonLabel : 'Use Folder',
      defaultPath: app.getPath('documents') || app.getPath('home'),
      properties: ['openDirectory', 'createDirectory']
    });
    if (canceled || !filePaths.length) return null;
    return filePaths[0];
  });

  ipcMain.handle('pick-project-location', async (_event, opts = {}) => {
    const win = getWindow();
    const projectName = projectService.sanitizeProjectName(opts.name || 'Untitled Project');
    const defaultBasePath = app.getPath('documents') || app.getPath('home');

    if (process.platform === 'win32') {
      const { canceled, filePaths } = await dialog.showOpenDialog(win, {
        title: `Choose where to create "${projectName}"`,
        buttonLabel: 'Create Project Here',
        defaultPath: defaultBasePath,
        properties: ['openDirectory']
      });
      if (canceled || !filePaths.length) return null;
      return path.join(filePaths[0], projectName);
    }

    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      title: `Choose where to create "${projectName}"`,
      buttonLabel: 'Create Project Here',
      defaultPath: defaultBasePath,
      properties: ['openDirectory', 'createDirectory']
    });
    if (canceled || !filePaths.length) return null;
    return path.join(filePaths[0], projectName);
  });

  ipcMain.handle('open-folder', async (_event, folder) => {
    shell.openPath(folder);
  });

  ipcMain.handle('project-create', async (_event, opts = {}) => {
    return projectService.createProject(opts);
  });

  ipcMain.handle('project-open', async (_event, projectFolder) => {
    return projectService.openProject(projectFolder);
  });

  ipcMain.handle('project-save', async (_event, payload = {}) => {
    return projectService.saveProject(payload);
  });

  ipcMain.handle('project-set-recovery-take', async (_event, payload = {}) => {
    return projectService.setRecoveryTake(payload);
  });

  ipcMain.handle('project-clear-recovery-take', async (_event, projectFolder) => {
    return projectService.clearRecoveryByProject(projectFolder);
  });

  ipcMain.handle('project-complete-recovery-take', async (_event, projectFolder) => {
    return projectService.completeRecoveryByProject(projectFolder);
  });

  ipcMain.handle('project-list-recent', async (_event, limit = 10) => {
    return projectService.listRecentProjects(limit);
  });

  ipcMain.handle('project-load-last', async () => {
    return projectService.loadLastProject();
  });

  ipcMain.handle('project-set-last', async (_event, projectFolder) => {
    return projectService.setLastProject(projectFolder);
  });

  ipcMain.handle('save-video', async (_event, buffer, folder, suffix) => {
    return projectService.saveVideo(buffer, folder, suffix);
  });

  ipcMain.handle('render-composite', async (event, opts) => {
    return renderComposite(opts, {
      onProgress: (progress) => {
        event.sender.send('render-composite-progress', progress);
      }
    });
  });

  ipcMain.handle('get-scribe-token', async () => {
    try {
      return await getScribeToken();
    } catch (error) {
      console.error('Failed to get Scribe token:', error);
      throw error;
    }
  });

  ipcMain.handle('compute-sections', async (_event, opts) => {
    return computeSections(opts);
  });

  ipcMain.handle('project:stageTakeFiles', async (_event, projectPath, filePaths) => {
    return projectService.stageTakeFiles(projectPath, filePaths);
  });

  ipcMain.handle('project:unstageTakeFiles', async (_event, projectPath, fileNames) => {
    return projectService.unstageTakeFiles(projectPath, fileNames);
  });

  ipcMain.handle('project:cleanupDeleted', async (_event, projectPath) => {
    return projectService.cleanupDeletedFolder(projectPath);
  });

  ipcMain.handle('project:cleanupUnusedTakes', async (_event, projectPath) => {
    return projectService.cleanupUnusedTakes(projectPath);
  });

  ipcMain.handle('project:importOverlayMedia', async (_event, projectPath, sourcePath) => {
    return projectService.importOverlayMedia(projectPath, sourcePath);
  });

  ipcMain.handle('project:stageOverlayFile', async (_event, projectPath, mediaPath) => {
    return projectService.stageOverlayFile(projectPath, mediaPath);
  });

  ipcMain.handle('project:unstageOverlayFile', async (_event, projectPath, mediaPath) => {
    return projectService.unstageOverlayFile(projectPath, mediaPath);
  });
}

module.exports = {
  registerIpcHandlers
};
