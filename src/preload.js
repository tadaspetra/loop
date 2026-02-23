const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  saveVideo: (buffer, folder, suffix) => ipcRenderer.invoke('save-video', buffer, folder, suffix),
  pickFolder: () => ipcRenderer.invoke('pick-folder'),
  openFolder: (folder) => ipcRenderer.invoke('open-folder', folder),
  getSources: () => ipcRenderer.invoke('get-sources'),
  renderComposite: (opts) => ipcRenderer.invoke('render-composite', opts)
})
