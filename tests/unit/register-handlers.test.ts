import { describe, expect, test, vi } from 'vitest';

import { registerIpcHandlers } from '../../src/main/ipc/register-handlers';
import { RetakeLlmUnavailableError } from '../../src/main/services/retake-llm-service';

function createProjectServiceStub() {
  return {
    sanitizeProjectName: (name: string) => name,
    createProject: vi.fn(),
    openProject: vi.fn(),
    saveProject: vi.fn(),
    setRecoveryTake: vi.fn(),
    clearRecoveryByProject: vi.fn(),
    completeRecoveryByProject: vi.fn(),
    listRecentProjects: vi.fn(),
    loadLastProject: vi.fn(),
    setLastProject: vi.fn(),
    saveVideo: vi.fn()
  };
}

function createProxyServiceStub() {
  return {
    deriveProxyPath: vi.fn((screenPath: string) => screenPath.replace(/\.webm$/, '-proxy.mp4')),
    generateProxy: vi.fn().mockResolvedValue(undefined),
    _getQueueState: vi.fn(),
    _resetQueue: vi.fn()
  };
}

function createRecordingServiceStub() {
  return {
    beginRecording: vi.fn(() => ({ tempPath: '/tmp/x.part', finalPath: '/tmp/x.webm' })),
    appendRecordingChunk: vi.fn().mockResolvedValue({ bytesWritten: 10 }),
    finalizeRecording: vi.fn(() => ({ path: '/tmp/x.webm', bytesWritten: 10 })),
    cancelRecording: vi.fn(() => ({ cancelled: true })),
    findOrphanRecordingParts: vi.fn(() => []),
    scanOrphanRecordings: vi.fn(() => []),
    recoverOrphanRecording: vi.fn(() => null),
    discardOrphanRecording: vi.fn(() => ({ discarded: 0 })),
    computeRecordingPaths: vi.fn(),
    listActiveRecordings: vi.fn(() => []),
    getActiveRecordingCount: vi.fn(() => 0),
    _resetForTests: vi.fn()
  };
}

function createCloseGuardStub() {
  return {
    setRecordingActive: vi.fn(),
    isRecordingActive: vi.fn(() => false),
    confirmClose: vi.fn(),
    handleCloseRequest: vi.fn(() => 'allow' as const)
  };
}

function registerWithHandlers(
  opts: {
    systemPreferences?: {
      askForMediaAccess: ReturnType<typeof vi.fn>;
      getMediaAccessStatus: ReturnType<typeof vi.fn>;
    };
    getWindow?: () => unknown;
  } = {}
) {
  const handlers = new Map<string, (event: unknown, payload: unknown) => unknown>();
  const listeners = new Map<string, (event: unknown, payload: unknown) => unknown>();
  const ipcMain = {
    handle(channel: string, handler: (event: unknown, payload: unknown) => unknown) {
      handlers.set(channel, handler);
    },
    on(channel: string, listener: (event: unknown, payload: unknown) => unknown) {
      listeners.set(channel, listener);
    }
  };
  const closeGuard = createCloseGuardStub();
  const renderComposite = vi.fn(
    async (_opts: unknown, deps: { onProgress?: (u: unknown) => void; signal?: AbortSignal }) => {
      deps.onProgress?.({ phase: 'rendering', percent: 0.5, status: 'Rendering 50%' });
      return '/tmp/output.mp4';
    }
  );
  const proxyService = createProxyServiceStub();
  const recordingService = createRecordingServiceStub();
  const transcribeRecordingFile = vi.fn(
    async (): Promise<{
      words: Array<{ text: string; start?: number; end?: number; type?: string }>;
      languageCode?: string;
    }> => ({ words: [], languageCode: 'eng' })
  );
  const detectRetakesWithLlm = vi.fn(
    async (): Promise<{ removedIndices: number[]; model: string }> => ({
      removedIndices: [],
      model: 'test-model'
    })
  );
  const exportPremiereProject = vi.fn(
    async (_opts: unknown, deps: { onProgress?: (u: unknown) => void; signal?: AbortSignal }) => {
      deps.onProgress?.({ phase: 'transcoding', percent: 0.5 });
      return {
        outputFolder: '/tmp/export',
        xmlPath: '/tmp/export/project.xml',
        mediaFolder: '/tmp/export/media'
      };
    }
  );

  registerIpcHandlers({
    ipcMain,
    app: { getPath: () => '/tmp' },
    dialog: { showOpenDialog: vi.fn() },
    desktopCapturer: { getSources: vi.fn() },
    shell: { openPath: vi.fn() },
    systemPreferences: opts.systemPreferences,
    getWindow: opts.getWindow || (() => null),
    closeGuard,
    projectService: createProjectServiceStub(),
    renderComposite,
    exportPremiereProject,
    computeSections: vi.fn(),
    transcribeRecordingFile,
    detectRetakesWithLlm,
    proxyService,
    recordingService,
    setPendingDisplayMediaSource: vi.fn()
  } as unknown as Parameters<typeof registerIpcHandlers>[0]);

  return {
    handlers,
    listeners,
    closeGuard,
    renderComposite,
    exportPremiereProject,
    proxyService,
    recordingService,
    transcribeRecordingFile,
    detectRetakesWithLlm
  };
}

describe('main/ipc/register-handlers', () => {
  test('transcription:transcribe delegates to the transcription service', async () => {
    const { handlers, transcribeRecordingFile } = registerWithHandlers();
    transcribeRecordingFile.mockResolvedValueOnce({
      words: [{ text: 'hi', start: 0, end: 0.3, type: 'word' }],
      languageCode: 'eng'
    });

    const result = await handlers.get('transcription:transcribe')!(
      {},
      { sourcePath: '/tmp/recording-take-audio.webm' }
    );

    expect(transcribeRecordingFile).toHaveBeenCalledWith({
      sourcePath: '/tmp/recording-take-audio.webm'
    });
    expect(result).toEqual({
      words: [{ text: 'hi', start: 0, end: 0.3, type: 'word' }],
      languageCode: 'eng'
    });
  });

  test('retake:detect-llm delegates to the LLM service and wraps the result', async () => {
    const { handlers, detectRetakesWithLlm } = registerWithHandlers();
    detectRetakesWithLlm.mockResolvedValueOnce({ removedIndices: [0, 2], model: 'test-model' });

    const chunks = [
      { index: 0, text: 'flub--', gapAfterSec: 1 },
      { index: 1, text: 'good take.', gapAfterSec: 0 }
    ];
    const result = await handlers.get('retake:detect-llm')!({}, { chunks });

    expect(detectRetakesWithLlm).toHaveBeenCalledWith({ chunks });
    expect(result).toEqual({ status: 'ok', removedIndices: [0, 2], model: 'test-model' });
  });

  test('retake:detect-llm maps a missing API key to an unavailable status', async () => {
    const { handlers, detectRetakesWithLlm } = registerWithHandlers();
    detectRetakesWithLlm.mockRejectedValueOnce(new RetakeLlmUnavailableError());

    const result = await handlers.get('retake:detect-llm')!(
      {},
      { chunks: [{ index: 0, text: 'x' }] }
    );
    expect(result).toEqual({ status: 'unavailable' });
  });

  test('retake:detect-llm rejects payloads without a chunks array', async () => {
    const { handlers, detectRetakesWithLlm } = registerWithHandlers();

    await expect(handlers.get('retake:detect-llm')!({}, {})).rejects.toThrow(/chunks/);
    await expect(handlers.get('retake:detect-llm')!({}, null)).rejects.toThrow(/chunks/);
    expect(detectRetakesWithLlm).not.toHaveBeenCalled();
  });

  test('transcription:transcribe rejects payloads without a sourcePath', async () => {
    const { handlers, transcribeRecordingFile } = registerWithHandlers();

    await expect(handlers.get('transcription:transcribe')!({}, {})).rejects.toThrow(
      /sourcePath/
    );
    await expect(handlers.get('transcription:transcribe')!({}, null)).rejects.toThrow(
      /sourcePath/
    );
    expect(transcribeRecordingFile).not.toHaveBeenCalled();
  });

  test('transcription:transcribe forwards an explicit languageCode', async () => {
    const { handlers, transcribeRecordingFile } = registerWithHandlers();

    await handlers.get('transcription:transcribe')!(
      {},
      { sourcePath: '/tmp/a.webm', languageCode: 'spa' }
    );

    expect(transcribeRecordingFile).toHaveBeenCalledWith({
      sourcePath: '/tmp/a.webm',
      languageCode: 'spa'
    });
  });

  test('request-media-access returns granted on non-mac platforms', async () => {
    const { handlers } = registerWithHandlers();

    await expect(handlers.get('request-media-access')!({}, 'camera')).resolves.toEqual({
      mediaType: 'camera',
      status: 'granted',
      granted: true
    });
  });

  test('request-media-access asks macOS when permission is not determined', async () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    try {
      const systemPreferences = {
        askForMediaAccess: vi.fn(async () => true),
        getMediaAccessStatus: vi
          .fn()
          .mockReturnValueOnce('not-determined')
          .mockReturnValueOnce('granted')
      };
      const { handlers } = registerWithHandlers({ systemPreferences });

      await expect(handlers.get('request-media-access')!({}, 'camera')).resolves.toEqual({
        mediaType: 'camera',
        status: 'granted',
        granted: true
      });
      expect(systemPreferences.askForMediaAccess).toHaveBeenCalledWith('camera');
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform });
    }
  });

  test('render-composite forwards progress updates over IPC', async () => {
    const { handlers, renderComposite } = registerWithHandlers();

    const sender = {
      send: vi.fn(),
      isDestroyed: vi.fn().mockReturnValue(false),
      once: vi.fn(),
      removeListener: vi.fn()
    };
    const result = await handlers.get('render-composite')!({ sender }, { sections: [] });

    expect(renderComposite).toHaveBeenCalledWith(
      { sections: [] },
      expect.objectContaining({
        onProgress: expect.any(Function)
      })
    );
    expect(sender.send).toHaveBeenCalledWith('render-composite-progress', {
      phase: 'rendering',
      percent: 0.5,
      status: 'Rendering 50%'
    });
    expect(result).toBe('/tmp/output.mp4');
  });

  test('render-composite suppresses progress when the renderer is destroyed', async () => {
    const { handlers } = registerWithHandlers();

    const sender = {
      send: vi.fn(),
      isDestroyed: vi.fn().mockReturnValue(true),
      once: vi.fn(),
      removeListener: vi.fn()
    };
    await handlers.get('render-composite')!({ sender }, { sections: [] });

    expect(sender.send).not.toHaveBeenCalled();
  });

  test('render-composite aborts the ffmpeg signal when the sender is destroyed', async () => {
    const { handlers, renderComposite } = registerWithHandlers();

    const destroyListeners: Array<() => void> = [];
    const sender = {
      send: vi.fn(),
      isDestroyed: vi.fn().mockReturnValue(false),
      once: vi.fn((event: string, listener: () => void) => {
        if (event === 'destroyed') destroyListeners.push(listener);
      }),
      removeListener: vi.fn()
    };

    let capturedSignal: AbortSignal | undefined;
    renderComposite.mockImplementationOnce(
      async (_opts: unknown, deps: { signal?: AbortSignal }) => {
        capturedSignal = deps.signal;
        // Emulate a renderer close by firing the captured destroyed listener
        // BEFORE renderComposite resolves, so we can observe the abort flow.
        destroyListeners.forEach((listener) => listener());
        return '/tmp/output.mp4';
      }
    );

    await handlers.get('render-composite')!({ sender }, { sections: [] });

    expect(capturedSignal).toBeDefined();
    expect(capturedSignal!.aborted).toBe(true);
    expect(sender.removeListener).toHaveBeenCalledWith('destroyed', expect.any(Function));
  });

  test('export-premiere-project forwards progress updates over IPC', async () => {
    const { handlers, exportPremiereProject } = registerWithHandlers();

    const sender = {
      send: vi.fn(),
      isDestroyed: vi.fn().mockReturnValue(false),
      once: vi.fn(),
      removeListener: vi.fn()
    };
    const result = await handlers.get('export-premiere-project')!(
      { sender },
      { outputFolder: '/tmp/x', sections: [], takes: [] }
    );

    expect(exportPremiereProject).toHaveBeenCalledWith(
      expect.objectContaining({ outputFolder: '/tmp/x' }),
      expect.objectContaining({ onProgress: expect.any(Function) })
    );
    expect(sender.send).toHaveBeenCalledWith('export-premiere-progress', {
      phase: 'transcoding',
      percent: 0.5
    });
    expect(result).toEqual({
      outputFolder: '/tmp/export',
      xmlPath: '/tmp/export/project.xml',
      mediaFolder: '/tmp/export/media'
    });
  });

  test('render-composite does not crash when sender.send throws', async () => {
    const { handlers } = registerWithHandlers();

    const sender = {
      send: vi.fn(() => {
        throw new Error('channel closed');
      }),
      isDestroyed: vi.fn().mockReturnValue(false),
      once: vi.fn(),
      removeListener: vi.fn()
    };
    await expect(handlers.get('render-composite')!({ sender }, { sections: [] })).resolves.toBe(
      '/tmp/output.mp4'
    );
  });

  test('proxy:generate returns derived proxy path and sends done on success', async () => {
    const { handlers } = registerWithHandlers();
    const sender = {
      send: vi.fn(),
      isDestroyed: vi.fn().mockReturnValue(false),
      once: vi.fn(),
      removeListener: vi.fn()
    };

    const result = handlers.get('proxy:generate')!(
      { sender },
      {
        takeId: 'take-1',
        screenPath: '/project/screen.webm',
        projectFolder: '/project',
        durationSec: 10
      }
    );

    expect(result).toBe('/project/screen-proxy.mp4');
    // Events now include `kind` so the renderer can route screen-proxy vs
    // camera-proxy completion to the correct fields on the Take.
    expect(sender.send).toHaveBeenCalledWith('proxy:progress', {
      takeId: 'take-1',
      kind: 'screen',
      status: 'started',
      percent: 0
    });

    // Wait for the background generation to complete
    await vi.waitFor(() => {
      expect(sender.send).toHaveBeenCalledWith('proxy:progress', {
        takeId: 'take-1',
        kind: 'screen',
        status: 'done',
        proxyPath: '/project/screen-proxy.mp4'
      });
    });
  });

  test('proxy:generate sends error on failure', async () => {
    const { handlers, proxyService } = registerWithHandlers();
    proxyService.generateProxy.mockRejectedValueOnce(new Error('encode failed'));
    const sender = {
      send: vi.fn(),
      isDestroyed: vi.fn().mockReturnValue(false),
      once: vi.fn(),
      removeListener: vi.fn()
    };

    handlers.get('proxy:generate')!(
      { sender },
      { takeId: 'take-1', screenPath: '/project/screen.webm', projectFolder: '/project' }
    );

    await vi.waitFor(() => {
      expect(sender.send).toHaveBeenCalledWith('proxy:progress', {
        takeId: 'take-1',
        kind: 'screen',
        status: 'error',
        error: 'encode failed'
      });
    });
  });

  test('proxy:generate with kind=camera emits camera-tagged events', async () => {
    // The renderer relies on `kind` to distinguish screen-proxy completion
    // from camera-proxy completion so it can set take.proxyPath vs
    // take.cameraProxyPath. Exercising the kind='camera' branch protects
    // that routing from silently regressing.
    const { handlers } = registerWithHandlers();
    const sender = {
      send: vi.fn(),
      isDestroyed: vi.fn().mockReturnValue(false),
      once: vi.fn(),
      removeListener: vi.fn()
    };

    const result = handlers.get('proxy:generate')!(
      { sender },
      {
        takeId: 'take-1',
        inputPath: '/project/camera.webm',
        projectFolder: '/project',
        durationSec: 10,
        kind: 'camera'
      }
    );

    expect(result).toBe('/project/camera-proxy.mp4');
    expect(sender.send).toHaveBeenCalledWith('proxy:progress', {
      takeId: 'take-1',
      kind: 'camera',
      status: 'started',
      percent: 0
    });
    await vi.waitFor(() => {
      expect(sender.send).toHaveBeenCalledWith('proxy:progress', {
        takeId: 'take-1',
        kind: 'camera',
        status: 'done',
        proxyPath: '/project/camera-proxy.mp4'
      });
    });
  });

  test('proxy:generate does not send events when sender is destroyed', async () => {
    const { handlers, proxyService } = registerWithHandlers();
    proxyService.generateProxy.mockResolvedValueOnce(undefined);
    const sender = {
      send: vi.fn(),
      isDestroyed: vi.fn().mockReturnValue(true),
      once: vi.fn(),
      removeListener: vi.fn()
    };

    handlers.get('proxy:generate')!(
      { sender },
      { takeId: 'take-1', screenPath: '/project/screen.webm', projectFolder: '/project' }
    );

    // Wait for the promise to settle
    await new Promise((r) => setTimeout(r, 50));

    // Only the initial 'started' is sent before isDestroyed check in the .then()
    const doneCalls = sender.send.mock.calls.filter(
      (c: unknown[]) => c[0] === 'proxy:progress' && (c[1] as { status: string }).status === 'done'
    );
    expect(doneCalls).toHaveLength(0);
  });

  test('proxy:generate returns null when screenPath is missing', () => {
    const { handlers } = registerWithHandlers();
    const sender = {
      send: vi.fn(),
      isDestroyed: vi.fn().mockReturnValue(false),
      once: vi.fn(),
      removeListener: vi.fn()
    };

    const result = handlers.get('proxy:generate')!(
      { sender },
      { takeId: 'take-1', screenPath: '', projectFolder: '/project' }
    );

    expect(result).toBeNull();
  });

  test('recording:begin/append/finalize/cancel forward to recordingService', async () => {
    const { handlers, recordingService } = registerWithHandlers();
    const sender = {
      send: vi.fn(),
      isDestroyed: vi.fn().mockReturnValue(false),
      once: vi.fn(),
      removeListener: vi.fn()
    };

    const begin = await handlers.get('recording:begin')!(
      { sender },
      { takeId: 'take-x', suffix: 'screen', folder: '/tmp' }
    );
    expect(begin).toEqual({ tempPath: '/tmp/x.part', finalPath: '/tmp/x.webm' });
    expect(recordingService.beginRecording).toHaveBeenCalledWith({
      takeId: 'take-x',
      suffix: 'screen',
      folder: '/tmp',
      extension: undefined
    });

    const append = await handlers.get('recording:append')!(
      { sender },
      { takeId: 'take-x', suffix: 'screen', data: new Uint8Array([1, 2, 3]) }
    );
    expect(append).toEqual({ bytesWritten: 10 });
    expect(recordingService.appendRecordingChunk).toHaveBeenCalled();

    const finalized = await handlers.get('recording:finalize')!(
      { sender },
      { takeId: 'take-x', suffix: 'screen' }
    );
    expect(finalized).toEqual({ path: '/tmp/x.webm', bytesWritten: 10 });

    const cancelled = await handlers.get('recording:cancel')!(
      { sender },
      { takeId: 'take-x', suffix: 'screen' }
    );
    expect(cancelled).toEqual({ cancelled: true });
  });

  test('recording:append rejects when data is missing', async () => {
    const { handlers } = registerWithHandlers();
    const sender = {
      send: vi.fn(),
      isDestroyed: vi.fn().mockReturnValue(false),
      once: vi.fn(),
      removeListener: vi.fn()
    };

    await expect(
      handlers.get('recording:append')!({ sender }, { takeId: 'take-x', suffix: 'screen' })
    ).rejects.toThrow(/missing recording chunk data/i);
  });

  test('recording:list-orphans returns [] when folder is empty/invalid', async () => {
    const { handlers } = registerWithHandlers();
    const sender = {
      send: vi.fn(),
      isDestroyed: vi.fn().mockReturnValue(false),
      once: vi.fn(),
      removeListener: vi.fn()
    };

    expect(await handlers.get('recording:list-orphans')!({ sender }, '')).toEqual([]);
    expect(await handlers.get('recording:list-orphans')!({ sender }, undefined)).toEqual([]);
  });

  test('recording:scan-orphans, recover-orphan, and discard-orphan forward to recordingService', async () => {
    const { handlers, recordingService } = registerWithHandlers();
    const sender = {
      send: vi.fn(),
      isDestroyed: vi.fn().mockReturnValue(false),
      once: vi.fn(),
      removeListener: vi.fn()
    };

    type AnyMock = { mockReturnValueOnce: (value: unknown) => unknown };
    (recordingService.scanOrphanRecordings as unknown as AnyMock).mockReturnValueOnce([
      { takeId: 'take-1', createdAt: '2024-01-01T00:00:00Z', screen: null, camera: null }
    ]);
    expect(await handlers.get('recording:scan-orphans')!({ sender }, '/project')).toEqual([
      { takeId: 'take-1', createdAt: '2024-01-01T00:00:00Z', screen: null, camera: null }
    ]);
    expect(recordingService.scanOrphanRecordings).toHaveBeenCalledWith('/project');

    (recordingService.recoverOrphanRecording as unknown as AnyMock).mockReturnValueOnce({
      takeId: 'take-1',
      createdAt: '2024-01-01T00:00:00Z',
      screenPath: '/project/recording-take-1-screen.webm',
      cameraPath: null
    });
    expect(
      await handlers.get('recording:recover-orphan')!(
        { sender },
        { folder: '/project', takeId: 'take-1' }
      )
    ).toEqual({
      takeId: 'take-1',
      createdAt: '2024-01-01T00:00:00Z',
      screenPath: '/project/recording-take-1-screen.webm',
      cameraPath: null
    });
    expect(recordingService.recoverOrphanRecording).toHaveBeenCalledWith('/project', 'take-1');

    recordingService.discardOrphanRecording.mockReturnValueOnce({ discarded: 2 });
    expect(
      await handlers.get('recording:discard-orphan')!(
        { sender },
        { folder: '/project', takeId: 'take-1' }
      )
    ).toEqual({ discarded: 2 });
  });

  test('recording recover/discard reject invalid payloads gracefully', async () => {
    const { handlers } = registerWithHandlers();
    const sender = {
      send: vi.fn(),
      isDestroyed: vi.fn().mockReturnValue(false),
      once: vi.fn(),
      removeListener: vi.fn()
    };

    expect(await handlers.get('recording:recover-orphan')!({ sender }, { takeId: 't' })).toBeNull();
    expect(await handlers.get('recording:discard-orphan')!({ sender }, { folder: '/p' })).toEqual({
      discarded: 0
    });
    expect(await handlers.get('recording:scan-orphans')!({ sender }, '')).toEqual([]);
  });

  test('recording:set-active forwards a coerced boolean to the close guard', () => {
    const { listeners, closeGuard } = registerWithHandlers();
    const listener = listeners.get('recording:set-active');
    expect(listener).toBeDefined();

    listener!({}, true);
    expect(closeGuard.setRecordingActive).toHaveBeenLastCalledWith(true);

    listener!({}, false);
    expect(closeGuard.setRecordingActive).toHaveBeenLastCalledWith(false);

    // A malformed payload must never flip the guard on by accident.
    listener!({}, undefined);
    expect(closeGuard.setRecordingActive).toHaveBeenLastCalledWith(false);

    listener!({}, 1);
    expect(closeGuard.setRecordingActive).toHaveBeenLastCalledWith(true);
  });

  test('app:confirm-close arms the bypass before closing the window', async () => {
    const win = { close: vi.fn(), isDestroyed: vi.fn(() => false) };
    const { handlers, closeGuard } = registerWithHandlers({ getWindow: () => win });

    await expect(handlers.get('app:confirm-close')!({}, undefined)).resolves.toBe(true);

    expect(closeGuard.confirmClose).toHaveBeenCalledTimes(1);
    expect(win.close).toHaveBeenCalledTimes(1);
    // Ordering matters: the bypass must be armed before close() re-triggers
    // the window 'close' event, otherwise the guard prevents its own close.
    const confirmOrder = closeGuard.confirmClose.mock.invocationCallOrder[0];
    const closeOrder = win.close.mock.invocationCallOrder[0];
    expect(confirmOrder).toBeLessThan(closeOrder);
  });

  test('app:confirm-close tolerates a missing or destroyed window', async () => {
    const { handlers, closeGuard } = registerWithHandlers();
    await expect(handlers.get('app:confirm-close')!({}, undefined)).resolves.toBe(false);
    expect(closeGuard.confirmClose).toHaveBeenCalled();

    const destroyed = { close: vi.fn(), isDestroyed: vi.fn(() => true) };
    const { handlers: handlers2 } = registerWithHandlers({ getWindow: () => destroyed });
    await expect(handlers2.get('app:confirm-close')!({}, undefined)).resolves.toBe(false);
    expect(destroyed.close).not.toHaveBeenCalled();
  });
});
