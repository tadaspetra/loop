const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  saveVideo: (buffer, folder, suffix) => ipcRenderer.invoke('save-video', buffer, folder, suffix),
  pickFolder: (opts) => ipcRenderer.invoke('pick-folder', opts),
  pickProjectLocation: (opts) => ipcRenderer.invoke('pick-project-location', opts),
  openFolder: (folder) => ipcRenderer.invoke('open-folder', folder),
  projectCreate: (opts) => ipcRenderer.invoke('project-create', opts),
  projectOpen: (projectFolder) => ipcRenderer.invoke('project-open', projectFolder),
  projectSave: (payload) => ipcRenderer.invoke('project-save', payload),
  projectListRecent: (limit) => ipcRenderer.invoke('project-list-recent', limit),
  projectLoadLast: () => ipcRenderer.invoke('project-load-last'),
  projectSetLast: (projectFolder) => ipcRenderer.invoke('project-set-last', projectFolder),
  setContentProtection: (enabled) => ipcRenderer.invoke('set-content-protection', enabled),
  getSources: () => ipcRenderer.invoke('get-sources'),
  concatVideos: (opts) => ipcRenderer.invoke('concat-videos', opts),
  renderComposite: (opts) => ipcRenderer.invoke('render-composite', opts),
  getScribeToken: () => ipcRenderer.invoke('get-scribe-token'),
  trimSilence: (opts) => ipcRenderer.invoke('trim-silence', opts)
})
