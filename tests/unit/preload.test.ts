import { beforeEach, describe, expect, test, vi } from 'vitest';

import type { ElectronApi } from '../../src/shared/electron-api';

const { mockContextBridge, mockIpcRenderer } = vi.hoisted(() => ({
  mockContextBridge: { exposeInMainWorld: vi.fn() },
  mockIpcRenderer: {
    invoke: vi.fn(),
    on: vi.fn(),
    removeListener: vi.fn()
  }
}));

vi.mock('electron', () => ({
  contextBridge: mockContextBridge,
  ipcRenderer: mockIpcRenderer
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
});
