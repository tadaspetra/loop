const { contextBridge, ipcRenderer, webUtils } = require('electron')
const url = require('node:url')

function toFileUrl(filePath) {
  const value = String(filePath || '')
  if (!value) return ''

  if (typeof url.pathToFileURL === 'function') {
    return url.pathToFileURL(value).toString()
  }

  const normalized = value.replace(/\\/g, '/')
  const withLeadingSlash = normalized.startsWith('/') ? normalized : `/${normalized}`
  return encodeURI(`file://${withLeadingSlash}`)
}

contextBridge.exposeInMainWorld('electronAPI', {
  saveVideo: (buffer, folder, suffix) => ipcRenderer.invoke('save-video', buffer, folder, suffix),
  pickFolder: (opts) => ipcRenderer.invoke('pick-folder', opts),
  pickProjectLocation: (opts) => ipcRenderer.invoke('pick-project-location', opts),
  pathToFileUrl: (filePath) => toFileUrl(filePath),
  openFolder: (folder) => ipcRenderer.invoke('open-folder', folder),
  projectCreate: (opts) => ipcRenderer.invoke('project-create', opts),
  projectOpen: (projectFolder) => ipcRenderer.invoke('project-open', projectFolder),
  projectSave: (payload) => ipcRenderer.invoke('project-save', payload),
  projectSetRecoveryTake: (payload) => ipcRenderer.invoke('project-set-recovery-take', payload),
  projectClearRecoveryTake: (projectFolder) => ipcRenderer.invoke('project-clear-recovery-take', projectFolder),
  projectCompleteRecoveryTake: (projectFolder) => ipcRenderer.invoke('project-complete-recovery-take', projectFolder),
  projectListRecent: (limit) => ipcRenderer.invoke('project-list-recent', limit),
  projectLoadLast: () => ipcRenderer.invoke('project-load-last'),
  projectSetLast: (projectFolder) => ipcRenderer.invoke('project-set-last', projectFolder),
  setContentProtection: (enabled) => ipcRenderer.invoke('set-content-protection', enabled),
  getSources: () => ipcRenderer.invoke('get-sources'),
  computeSections: (opts) => ipcRenderer.invoke('compute-sections', opts),
  renderComposite: (opts) => ipcRenderer.invoke('render-composite', opts),
  onRenderProgress: (listener) => {
    if (typeof listener !== 'function') return () => {};
    const handler = (_event, payload) => listener(payload);
    ipcRenderer.on('render-composite-progress', handler);
    return () => ipcRenderer.removeListener('render-composite-progress', handler);
  },
  getScribeToken: () => ipcRenderer.invoke('get-scribe-token'),
  stageTakeFiles: (projectPath, filePaths) => ipcRenderer.invoke('project:stageTakeFiles', projectPath, filePaths),
  unstageTakeFiles: (projectPath, fileNames) => ipcRenderer.invoke('project:unstageTakeFiles', projectPath, fileNames),
  cleanupDeleted: (projectPath) => ipcRenderer.invoke('project:cleanupDeleted', projectPath),
  cleanupUnusedTakes: (projectPath) => ipcRenderer.invoke('project:cleanupUnusedTakes', projectPath),
  importOverlayMedia: (projectPath, sourcePath) => ipcRenderer.invoke('project:importOverlayMedia', projectPath, sourcePath),
  stageOverlayFile: (projectPath, mediaPath) => ipcRenderer.invoke('project:stageOverlayFile', projectPath, mediaPath),
  unstageOverlayFile: (projectPath, mediaPath) => ipcRenderer.invoke('project:unstageOverlayFile', projectPath, mediaPath),
  getFilePathFromDrop: (file) => {
    try { return webUtils.getPathForFile(file); } catch (_) { return null; }
  },
  getCursorPosition: () => ipcRenderer.invoke('get-cursor-position'),
  startMouseTrail: () => ipcRenderer.invoke('start-mouse-trail'),
  stopMouseTrail: () => ipcRenderer.invoke('stop-mouse-trail'),
  saveMouseTrail: (projectPath, suffix, trailData) => ipcRenderer.invoke('save-mouse-trail', projectPath, suffix, trailData),
  generateProxy: (opts) => ipcRenderer.invoke('proxy:generate', opts),
  onProxyProgress: (listener) => {
    if (typeof listener !== 'function') return () => {};
    const handler = (_event, payload) => listener(payload);
    ipcRenderer.on('proxy:progress', handler);
    return () => ipcRenderer.removeListener('proxy:progress', handler);
  }
})
