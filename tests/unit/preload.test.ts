import { beforeEach, describe, expect, test, vi } from 'vitest';

import type { ElectronApi } from '../../src/shared/electron-api';

const { mockContextBridge, mockIpcRenderer, mockWebUtils } = vi.hoisted(() => ({
  mockContextBridge: { exposeInMainWorld: vi.fn() },
  mockIpcRenderer: {
    invoke: vi.fn(),
    on: vi.fn(),
    removeListener: vi.fn()
  },
  mockWebUtils: {
    getPathForFile: vi.fn((file: unknown) =>
      (file as { _mockPath?: string })?._mockPath || ''
    )
  }
}));

vi.mock('electron', () => ({
  contextBridge: mockContextBridge,
  ipcRenderer: mockIpcRenderer,
  webUtils: mockWebUtils
}));

describe('preload', () => {
  let electronAPI: ElectronApi;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    mockContextBridge.exposeInMainWorld.mockImplementation((_name, api) => {
      electronAPI = api as ElectronApi;
    });
    await import('../../src/preload');
  });

  test('exposes render progress listener with unsubscribe support', () => {
    const listener = vi.fn();
    const unsubscribe = electronAPI.onRenderProgress(listener);

    expect(mockIpcRenderer.on).toHaveBeenCalledWith(
      'render-composite-progress',
      expect.any(Function)
    );

    const handler = mockIpcRenderer.on.mock.calls[0][1] as (
      _event: unknown,
      payload: { percent: number; status: string }
    ) => void;
    handler({}, { percent: 0.4, status: 'Rendering 40%' });

    expect(listener).toHaveBeenCalledWith({ percent: 0.4, status: 'Rendering 40%' });

    unsubscribe();

    expect(mockIpcRenderer.removeListener).toHaveBeenCalledWith(
      'render-composite-progress',
      handler
    );
  });

  test('exportPremiereProject invokes matching IPC channel and progress listener attaches', () => {
    electronAPI.exportPremiereProject({ outputFolder: '/tmp/x', takes: [], sections: [] });
    expect(mockIpcRenderer.invoke).toHaveBeenCalledWith('export-premiere-project', {
      outputFolder: '/tmp/x',
      takes: [],
      sections: []
    });

    const listener = vi.fn();
    const unsubscribe = electronAPI.onExportPremiereProgress(listener);
    expect(mockIpcRenderer.on).toHaveBeenCalledWith(
      'export-premiere-progress',
      expect.any(Function)
    );

    const handler = mockIpcRenderer.on.mock.calls
      .reverse()
      .find((call) => call[0] === 'export-premiere-progress')?.[1] as (
      _event: unknown,
      payload: unknown
    ) => void;
    handler({}, { phase: 'transcoding', percent: 0.25 });
    expect(listener).toHaveBeenCalledWith({ phase: 'transcoding', percent: 0.25 });

    unsubscribe();
    expect(mockIpcRenderer.removeListener).toHaveBeenCalledWith(
      'export-premiere-progress',
      handler
    );
  });

  test('getPathForFile delegates to webUtils for drag-dropped files', () => {
    const file = { _mockPath: '/Users/test/foo.png' } as unknown as File;
    expect(electronAPI.getPathForFile(file)).toBe('/Users/test/foo.png');
    expect(mockWebUtils.getPathForFile).toHaveBeenCalledWith(file);
  });

  test('getPathForFile returns empty string for missing/invalid files', () => {
    expect(electronAPI.getPathForFile(null as unknown as File)).toBe('');
    expect(electronAPI.getPathForFile({} as unknown as File)).toBe('');
  });

  test('recording lifecycle methods invoke the matching IPC channels', () => {
    electronAPI.recordingBegin({ takeId: 't', suffix: 'screen', folder: '/tmp' });
    expect(mockIpcRenderer.invoke).toHaveBeenCalledWith('recording:begin', {
      takeId: 't',
      suffix: 'screen',
      folder: '/tmp'
    });

    const data = new Uint8Array([1, 2, 3]);
    electronAPI.recordingAppend({ takeId: 't', suffix: 'screen', data });
    expect(mockIpcRenderer.invoke).toHaveBeenCalledWith('recording:append', {
      takeId: 't',
      suffix: 'screen',
      data
    });

    electronAPI.recordingFinalize({ takeId: 't', suffix: 'screen' });
    expect(mockIpcRenderer.invoke).toHaveBeenCalledWith('recording:finalize', {
      takeId: 't',
      suffix: 'screen'
    });

    electronAPI.recordingCancel({ takeId: 't', suffix: 'screen' });
    expect(mockIpcRenderer.invoke).toHaveBeenCalledWith('recording:cancel', {
      takeId: 't',
      suffix: 'screen'
    });

    electronAPI.recordingListOrphans('/proj');
    expect(mockIpcRenderer.invoke).toHaveBeenCalledWith('recording:list-orphans', '/proj');

    electronAPI.recordingScanOrphans('/proj');
    expect(mockIpcRenderer.invoke).toHaveBeenCalledWith('recording:scan-orphans', '/proj');

    electronAPI.recordingRecoverOrphan({ folder: '/proj', takeId: 'take-1' });
    expect(mockIpcRenderer.invoke).toHaveBeenCalledWith('recording:recover-orphan', {
      folder: '/proj',
      takeId: 'take-1'
    });

    electronAPI.recordingDiscardOrphan({ folder: '/proj', takeId: 'take-1' });
    expect(mockIpcRenderer.invoke).toHaveBeenCalledWith('recording:discard-orphan', {
      folder: '/proj',
      takeId: 'take-1'
    });
  });
});
