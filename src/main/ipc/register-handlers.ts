import path from 'node:path';

import { copyFile } from '../infra/file-system';
import type {
  App,
  BrowserWindow,
  DesktopCapturer,
  Dialog,
  IpcMain,
  IpcMainInvokeEvent,
  OpenDialogOptions,
  Shell
} from 'electron';

import type { createProjectService } from '../services/project-service';
import type { renderComposite } from '../services/render-service';
import type { exportPremiereProject } from '../services/premiere-export-service';
import type { computeSections } from '../services/sections-service';
import type * as proxyServiceModule from '../services/proxy-service';
import type * as recordingServiceModule from '../services/recording-service';

type ProjectService = ReturnType<typeof createProjectService>;

type RenderComposite = typeof renderComposite;
type ExportPremiereProject = typeof exportPremiereProject;
type ComputeSections = typeof computeSections;
type ProxyService = typeof proxyServiceModule;
type RecordingService = typeof recordingServiceModule;

interface PickFolderOptions {
  title?: string;
  buttonLabel?: string;
  name?: string;
}

export function registerIpcHandlers({
  ipcMain,
  app,
  dialog,
  desktopCapturer,
  shell,
  getWindow,
  projectService,
  renderComposite,
  exportPremiereProject,
  computeSections,
  getScribeToken,
  proxyService,
  recordingService,
  setPendingDisplayMediaSource
}: {
  ipcMain: IpcMain;
  app: App;
  dialog: Dialog;
  desktopCapturer: DesktopCapturer;
  shell: Shell;
  getWindow: () => BrowserWindow | null;
  projectService: ProjectService;
  renderComposite: RenderComposite;
  exportPremiereProject: ExportPremiereProject;
  computeSections: ComputeSections;
  getScribeToken: () => Promise<string>;
  proxyService: ProxyService;
  recordingService: RecordingService;
  setPendingDisplayMediaSource: (sourceId: string | null) => void;
}): void {
  async function showOpenDialog(opts: OpenDialogOptions) {
    const win = getWindow();
    return win ? dialog.showOpenDialog(win, opts) : dialog.showOpenDialog(opts);
  }

  ipcMain.handle('set-content-protection', async (_event, enabled) => {
    const win = getWindow();
    if (!win || win.isDestroyed()) return false;
    win.setContentProtection(Boolean(enabled));
    return true;
  });

  ipcMain.handle('prepare-display-media', (_event, payload) => {
    // Stash the chosen desktop source id so the display-media request handler
    // can resolve the next getDisplayMedia call. Called just before the
    // renderer's getDisplayMedia() when system audio is enabled.
    const sourceId =
      payload && typeof (payload as { sourceId?: unknown }).sourceId === 'string'
        ? ((payload as { sourceId: string }).sourceId)
        : null;
    setPendingDisplayMediaSource(sourceId);
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

  ipcMain.handle('pick-folder', async (_event, opts: PickFolderOptions = {}) => {
    const { canceled, filePaths } = await showOpenDialog({
      title: typeof opts.title === 'string' && opts.title ? opts.title : 'Choose Folder',
      buttonLabel:
        typeof opts.buttonLabel === 'string' && opts.buttonLabel ? opts.buttonLabel : 'Use Folder',
      defaultPath: app.getPath('documents') || app.getPath('home'),
      properties: ['openDirectory', 'createDirectory']
    });
    if (canceled || !filePaths.length) return null;
    return filePaths[0];
  });

  ipcMain.handle('pick-project-location', async (_event, opts: PickFolderOptions = {}) => {
    const projectName = projectService.sanitizeProjectName(opts.name || 'Untitled Project');
    const defaultBasePath = app.getPath('documents') || app.getPath('home');

    if (process.platform === 'win32') {
      const { canceled, filePaths } = await showOpenDialog({
        title: `Choose where to create "${projectName}"`,
        buttonLabel: 'Create Project Here',
        defaultPath: defaultBasePath,
        properties: ['openDirectory']
      });
      if (canceled || !filePaths.length) return null;
      return path.join(filePaths[0], projectName);
    }

    const { canceled, filePaths } = await showOpenDialog({
      title: `Choose where to create "${projectName}"`,
      buttonLabel: 'Create Project Here',
      defaultPath: defaultBasePath,
      properties: ['openDirectory', 'createDirectory']
    });
    if (canceled || !filePaths.length) return null;
    return path.join(filePaths[0], projectName);
  });

  ipcMain.handle('open-folder', async (_event, folder: string) => {
    shell.openPath(folder);
  });

  ipcMain.handle('project-create', async (_event, opts = {}) => {
    return projectService.createProject(opts);
  });

  ipcMain.handle('project-open', async (_event, projectFolder: string) => {
    return projectService.openProject(projectFolder);
  });

  ipcMain.handle('project-save', async (_event, payload = {}) => {
    return projectService.saveProject(payload);
  });

  ipcMain.handle('project-set-recovery-take', async (_event, payload = {}) => {
    return projectService.setRecoveryTake(payload);
  });

  ipcMain.handle('project-clear-recovery-take', async (_event, projectFolder: string) => {
    return projectService.clearRecoveryByProject(projectFolder);
  });

  ipcMain.handle('project-complete-recovery-take', async (_event, projectFolder: string) => {
    return projectService.completeRecoveryByProject(projectFolder);
  });

  ipcMain.handle('project-list-recent', async (_event, limit = 10) => {
    return projectService.listRecentProjects(limit);
  });

  ipcMain.handle('project-load-last', async () => {
    return projectService.loadLastProject();
  });

  ipcMain.handle('project-set-last', async (_event, projectFolder: string) => {
    return projectService.setLastProject(projectFolder);
  });

  ipcMain.handle(
    'save-video',
    async (_event, buffer: ArrayBuffer, folder: string, suffix?: string) => {
      return projectService.saveVideo(buffer, folder, suffix);
    }
  );

  // Track in-flight ffmpeg operations so they can be torn down when the
  // renderer that requested them goes away. This prevents orphan ffmpeg
  // processes from surviving a window close / reload mid-render.
  const activeFfmpegAborts = new Set<AbortController>();

  ipcMain.handle('render-composite', async (event: IpcMainInvokeEvent, opts: unknown) => {
    const controller = new AbortController();
    activeFfmpegAborts.add(controller);

    const onSenderDestroy = () => controller.abort();
    event.sender.once('destroyed', onSenderDestroy);

    try {
      return await renderComposite(opts as Parameters<RenderComposite>[0], {
        signal: controller.signal,
        onProgress: (progress) => {
          if (event.sender.isDestroyed()) return;
          try {
            event.sender.send('render-composite-progress', progress);
          } catch (error) {
            // The renderer may be tearing down mid-render; swallowing keeps the
            // ffmpeg process draining rather than crashing the main process.
            console.warn('render-composite-progress send failed:', error);
          }
        }
      });
    } finally {
      activeFfmpegAborts.delete(controller);
      try {
        event.sender.removeListener('destroyed', onSenderDestroy);
      } catch {
        // Sender may already be gone; ignore.
      }
    }
  });

  ipcMain.handle('export-premiere-project', async (event: IpcMainInvokeEvent, opts: unknown) => {
    const controller = new AbortController();
    activeFfmpegAborts.add(controller);

    const onSenderDestroy = () => controller.abort();
    event.sender.once('destroyed', onSenderDestroy);

    try {
      return await exportPremiereProject(opts as Parameters<ExportPremiereProject>[0], {
        signal: controller.signal,
        onProgress: (progress) => {
          if (event.sender.isDestroyed()) return;
          try {
            event.sender.send('export-premiere-progress', progress);
          } catch (error) {
            console.warn('export-premiere-progress send failed:', error);
          }
        }
      });
    } finally {
      activeFfmpegAborts.delete(controller);
      try {
        event.sender.removeListener('destroyed', onSenderDestroy);
      } catch {
        // Sender may already be gone; ignore.
      }
    }
  });

  ipcMain.handle('import-file', async (_event, sourcePath: string, projectFolder: string) => {
    if (!sourcePath || !projectFolder) throw new Error('Missing source path or project folder');
    return copyFile(path.resolve(sourcePath), path.resolve(projectFolder), 'image');
  });

  ipcMain.handle('pick-image-file', async () => {
    const { canceled, filePaths } = await showOpenDialog({
      title: 'Select Image',
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] }],
      properties: ['openFile']
    });
    if (canceled || !filePaths.length) return null;
    return filePaths[0];
  });

  ipcMain.handle('get-scribe-token', async () => {
    try {
      return await getScribeToken();
    } catch (error) {
      console.error('Failed to get Scribe token:', error);
      throw error;
    }
  });

  ipcMain.handle('compute-sections', async (_event, opts: unknown) => {
    return computeSections(opts as Parameters<ComputeSections>[0]);
  });

  ipcMain.handle(
    'proxy:generate',
    (
      event: IpcMainInvokeEvent,
      opts: { takeId: string; screenPath: string; projectFolder: string; durationSec?: number }
    ) => {
      if (!proxyService || !opts.screenPath || !opts.projectFolder) return null;
      const proxyPath = proxyService.deriveProxyPath(opts.screenPath);
      const totalDuration =
        Number.isFinite(opts.durationSec) && (opts.durationSec as number) > 0
          ? (opts.durationSec as number)
          : 0;

      const safeSend = (payload: unknown) => {
        if (event.sender.isDestroyed()) return;
        try {
          event.sender.send('proxy:progress', payload);
        } catch (error) {
          console.warn('proxy:progress send failed:', error);
        }
      };
      safeSend({ takeId: opts.takeId, status: 'started', percent: 0 });

      const controller = new AbortController();
      activeFfmpegAborts.add(controller);
      const onSenderDestroy = () => controller.abort();
      event.sender.once('destroyed', onSenderDestroy);

      const onProgress =
        totalDuration > 0
          ? (progress: { outTimeSec: number | null }) => {
              const outSec = progress.outTimeSec;
              if (Number.isFinite(outSec) && outSec !== null && outSec >= 0) {
                const percent = Math.max(0, Math.min(1, outSec / totalDuration));
                safeSend({
                  takeId: opts.takeId,
                  status: 'progress',
                  percent
                });
              }
            }
          : undefined;

      proxyService
        .generateProxy({
          screenPath: opts.screenPath,
          proxyPath,
          onProgress,
          signal: controller.signal
        })
        .then(() => {
          safeSend({ takeId: opts.takeId, status: 'done', proxyPath });
        })
        .catch((err: unknown) => {
          const message = err instanceof Error ? err.message : String(err);
          safeSend({
            takeId: opts.takeId,
            status: 'error',
            error: message
          });
        })
        .finally(() => {
          activeFfmpegAborts.delete(controller);
          try {
            event.sender.removeListener('destroyed', onSenderDestroy);
          } catch {
            // Already gone; ignore.
          }
        });

      return proxyPath;
    }
  );

  // Recording lifecycle: streams recorder chunks directly to disk so a
  // renderer crash or timeout never drops captured bytes. Each recorder
  // (screen, camera) opens an independent write handle keyed by
  // (takeId, suffix) and finalizes with an atomic rename.
  ipcMain.handle('recording:begin', async (_event, payload: unknown) => {
    const opts = (payload || {}) as {
      takeId?: string;
      suffix?: string;
      folder?: string;
      extension?: string;
    };
    return recordingService.beginRecording({
      takeId: String(opts.takeId || ''),
      suffix: String(opts.suffix || ''),
      folder: String(opts.folder || ''),
      extension: typeof opts.extension === 'string' ? opts.extension : undefined
    });
  });

  ipcMain.handle('recording:append', async (_event, payload: unknown) => {
    const opts = (payload || {}) as {
      takeId?: string;
      suffix?: string;
      data?: ArrayBuffer | Uint8Array;
    };
    if (!opts.data) throw new Error('Missing recording chunk data');
    return recordingService.appendRecordingChunk({
      takeId: String(opts.takeId || ''),
      suffix: String(opts.suffix || ''),
      data: opts.data
    });
  });

  ipcMain.handle('recording:finalize', async (_event, payload: unknown) => {
    const opts = (payload || {}) as { takeId?: string; suffix?: string };
    return recordingService.finalizeRecording({
      takeId: String(opts.takeId || ''),
      suffix: String(opts.suffix || '')
    });
  });

  ipcMain.handle('recording:cancel', async (_event, payload: unknown) => {
    const opts = (payload || {}) as { takeId?: string; suffix?: string };
    return recordingService.cancelRecording({
      takeId: String(opts.takeId || ''),
      suffix: String(opts.suffix || '')
    });
  });

  ipcMain.handle('recording:list-orphans', async (_event, folder: unknown) => {
    if (typeof folder !== 'string' || !folder.trim()) return [];
    return recordingService.findOrphanRecordingParts(folder);
  });

  ipcMain.handle('recording:scan-orphans', async (_event, folder: unknown) => {
    if (typeof folder !== 'string' || !folder.trim()) return [];
    return recordingService.scanOrphanRecordings(folder);
  });

  ipcMain.handle(
    'recording:recover-orphan',
    async (_event, payload: unknown) => {
      const opts = (payload || {}) as { folder?: string; takeId?: string };
      if (!opts.folder || !opts.takeId) return null;
      return recordingService.recoverOrphanRecording(opts.folder, opts.takeId);
    }
  );

  ipcMain.handle(
    'recording:discard-orphan',
    async (_event, payload: unknown) => {
      const opts = (payload || {}) as { folder?: string; takeId?: string };
      if (!opts.folder || !opts.takeId) return { discarded: 0 };
      return recordingService.discardOrphanRecording(opts.folder, opts.takeId);
    }
  );
}
