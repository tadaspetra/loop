const electronModuleId = require.resolve('electron');

describe('preload', () => {
  let electronAPI;
  let contextBridge;
  let ipcRenderer;

  beforeEach(() => {
    vi.clearAllMocks();
    contextBridge = {
      exposeInMainWorld: vi.fn()
    };
    ipcRenderer = {
      invoke: vi.fn(),
      on: vi.fn(),
      removeListener: vi.fn()
    };
    require.cache[electronModuleId] = {
      id: electronModuleId,
      filename: electronModuleId,
      loaded: true,
      exports: {
        contextBridge,
        ipcRenderer
      }
    };
    delete require.cache[require.resolve('../../src/preload.js')];
    contextBridge.exposeInMainWorld.mockImplementation((_name, api) => {
      electronAPI = api;
    });
    require('../../src/preload.js');
  });

  test('exposes render progress listener with unsubscribe support', () => {
    const listener = vi.fn();
    const unsubscribe = electronAPI.onRenderProgress(listener);

    expect(ipcRenderer.on).toHaveBeenCalledWith('render-composite-progress', expect.any(Function));

    const handler = ipcRenderer.on.mock.calls[0][1];
    handler({}, { percent: 0.4, status: 'Rendering 40%' });

    expect(listener).toHaveBeenCalledWith({ percent: 0.4, status: 'Rendering 40%' });

    unsubscribe();

    expect(ipcRenderer.removeListener).toHaveBeenCalledWith('render-composite-progress', handler);
  });
});
