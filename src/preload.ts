import { contextBridge, ipcRenderer, webUtils } from 'electron';
import url from 'node:url';

import type { ElectronApi, RenderProgressUpdate, ProxyProgressUpdate } from './shared/electron-api';

function toFileUrl(filePath: string | null | undefined): string {
  const value = String(filePath || '');
  if (!value) return '';

  if (typeof url.pathToFileURL === 'function') {
    return url.pathToFileURL(value).toString();
  }

  const normalized = value.replace(/\\/g, '/');
  const withLeadingSlash = normalized.startsWith('/') ? normalized : `/${normalized}`;
  return encodeURI(`file://${withLeadingSlash}`);
}

const electronApi: ElectronApi = {
  saveVideo: (buffer, folder, suffix) => ipcRenderer.invoke('save-video', buffer, folder, suffix),
  pickFolder: (opts) => ipcRenderer.invoke('pick-folder', opts),
  pickProjectLocation: (opts) => ipcRenderer.invoke('pick-project-location', opts),
  pathToFileUrl: (filePath) => toFileUrl(filePath),
  openFolder: (folder) => ipcRenderer.invoke('open-folder', folder),
  projectCreate: (opts) => ipcRenderer.invoke('project-create', opts),
  projectOpen: (projectFolder) => ipcRenderer.invoke('project-open', projectFolder),
  projectSave: (payload) => ipcRenderer.invoke('project-save', payload),
  projectSetRecoveryTake: (payload) => ipcRenderer.invoke('project-set-recovery-take', payload),
  projectClearRecoveryTake: (projectFolder) =>
    ipcRenderer.invoke('project-clear-recovery-take', projectFolder),
  projectCompleteRecoveryTake: (projectFolder) =>
    ipcRenderer.invoke('project-complete-recovery-take', projectFolder),
  projectListRecent: (limit) => ipcRenderer.invoke('project-list-recent', limit),
  projectLoadLast: () => ipcRenderer.invoke('project-load-last'),
  projectSetLast: (projectFolder) => ipcRenderer.invoke('project-set-last', projectFolder),
  setContentProtection: (enabled) => ipcRenderer.invoke('set-content-protection', enabled),
  getSources: () => ipcRenderer.invoke('get-sources'),
  computeSections: (opts) => ipcRenderer.invoke('compute-sections', opts),
  renderComposite: (opts) => ipcRenderer.invoke('render-composite', opts),
  onRenderProgress: (listener) => {
    if (typeof listener !== 'function') return () => {};
    const handler = (_event: unknown, payload: RenderProgressUpdate) => listener(payload);
    ipcRenderer.on('render-composite-progress', handler);
    return () => ipcRenderer.removeListener('render-composite-progress', handler);
  },
  exportPremiereProject: (opts) => ipcRenderer.invoke('export-premiere-project', opts),
  onExportPremiereProgress: (listener) => {
    if (typeof listener !== 'function') return () => {};
    const handler = (_event: unknown, payload: RenderProgressUpdate) => listener(payload);
    ipcRenderer.on('export-premiere-progress', handler);
    return () => ipcRenderer.removeListener('export-premiere-progress', handler);
  },
  importFile: (sourcePath, projectFolder) =>
    ipcRenderer.invoke('import-file', sourcePath, projectFolder),
  pickImageFile: () => ipcRenderer.invoke('pick-image-file'),
  getScribeToken: () => ipcRenderer.invoke('get-scribe-token'),
  generateProxy: (opts) => ipcRenderer.invoke('proxy:generate', opts),
  onProxyProgress: (listener) => {
    if (typeof listener !== 'function') return () => {};
    const handler = (_event: unknown, payload: ProxyProgressUpdate) => listener(payload);
    ipcRenderer.on('proxy:progress', handler);
    return () => ipcRenderer.removeListener('proxy:progress', handler);
  },
  getPathForFile: (file) => {
    // Electron 32+ removed File.path; webUtils.getPathForFile is the supported
    // bridge. Guard against non-File inputs from the renderer.
    if (!file || typeof webUtils?.getPathForFile !== 'function') return '';
    try {
      return webUtils.getPathForFile(file) || '';
    } catch {
      return '';
    }
  },
  recordingBegin: (opts) => ipcRenderer.invoke('recording:begin', opts),
  recordingAppend: (opts) => ipcRenderer.invoke('recording:append', opts),
  recordingFinalize: (opts) => ipcRenderer.invoke('recording:finalize', opts),
  recordingCancel: (opts) => ipcRenderer.invoke('recording:cancel', opts),
  recordingListOrphans: (folder) => ipcRenderer.invoke('recording:list-orphans', folder),
  recordingScanOrphans: (folder) => ipcRenderer.invoke('recording:scan-orphans', folder),
  recordingRecoverOrphan: (opts) => ipcRenderer.invoke('recording:recover-orphan', opts),
  recordingDiscardOrphan: (opts) => ipcRenderer.invoke('recording:discard-orphan', opts)
};

contextBridge.exposeInMainWorld('electronAPI', electronApi);
