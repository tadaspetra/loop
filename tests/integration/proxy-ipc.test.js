const { registerIpcHandlers } = require('../../src/main/ipc/register-handlers');

function makeIpcMain() {
  const handlers = new Map();
  return {
    handle(channel, handler) { handlers.set(channel, handler); },
    get(channel) { return handlers.get(channel); }
  };
}

function makeProjectServiceStub() {
  return {
    sanitizeProjectName: (n) => n,
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

function makeSender(destroyed = false) {
  return {
    isDestroyed: () => destroyed,
    send: vi.fn()
  };
}

describe('proxy:generate IPC handler', () => {
  test('calls generateProxy and sends done event on success', async () => {
    const ipcMain = makeIpcMain();
    const proxyPath = '/proj/screen-proxy.mp4';
    const proxyService = {
      deriveProxyPath: vi.fn(() => proxyPath),
      generateProxy: vi.fn(async () => {})
    };

    registerIpcHandlers({
      ipcMain,
      app: { getPath: () => '/tmp' },
      dialog: { showOpenDialog: vi.fn() },
      desktopCapturer: { getSources: vi.fn() },
      shell: { openPath: vi.fn() },
      getWindow: () => null,
      screen: null,
      projectService: makeProjectServiceStub(),
      renderComposite: vi.fn(),
      computeSections: vi.fn(),
      getScribeToken: vi.fn(),
      proxyService
    });

    const sender = makeSender();
    const result = ipcMain.get('proxy:generate')(
      { sender },
      { takeId: 'take-1', screenPath: '/proj/screen.webm', projectFolder: '/proj' }
    );

    // handler returns the expected proxy path synchronously
    expect(result).toBe(proxyPath);
    expect(sender.send).toHaveBeenCalledWith('proxy:progress', { takeId: 'take-1', status: 'started', percent: 0 });

    // wait for the async generateProxy to resolve
    await new Promise(r => setTimeout(r, 0));
    expect(proxyService.generateProxy).toHaveBeenCalledWith({
      screenPath: '/proj/screen.webm',
      proxyPath
    });
    expect(sender.send).toHaveBeenCalledWith('proxy:progress', {
      takeId: 'take-1',
      status: 'done',
      proxyPath
    });
  });

  test('sends error event when generateProxy rejects', async () => {
    const ipcMain = makeIpcMain();
    const proxyService = {
      deriveProxyPath: vi.fn(() => '/proj/screen-proxy.mp4'),
      generateProxy: vi.fn(async () => { throw new Error('ffmpeg failed'); })
    };

    registerIpcHandlers({
      ipcMain,
      app: { getPath: () => '/tmp' },
      dialog: { showOpenDialog: vi.fn() },
      desktopCapturer: { getSources: vi.fn() },
      shell: { openPath: vi.fn() },
      getWindow: () => null,
      screen: null,
      projectService: makeProjectServiceStub(),
      renderComposite: vi.fn(),
      computeSections: vi.fn(),
      getScribeToken: vi.fn(),
      proxyService
    });

    const sender = makeSender();
    ipcMain.get('proxy:generate')(
      { sender },
      { takeId: 'take-2', screenPath: '/proj/screen.webm', projectFolder: '/proj' }
    );

    await new Promise(r => setTimeout(r, 0));

    expect(sender.send).toHaveBeenCalledWith('proxy:progress', {
      takeId: 'take-2',
      status: 'error',
      error: 'ffmpeg failed'
    });
  });

  test('does not send event if sender is destroyed before completion', async () => {
    const ipcMain = makeIpcMain();
    const proxyService = {
      deriveProxyPath: vi.fn(() => '/proj/screen-proxy.mp4'),
      generateProxy: vi.fn(async () => {})
    };

    registerIpcHandlers({
      ipcMain,
      app: { getPath: () => '/tmp' },
      dialog: { showOpenDialog: vi.fn() },
      desktopCapturer: { getSources: vi.fn() },
      shell: { openPath: vi.fn() },
      getWindow: () => null,
      screen: null,
      projectService: makeProjectServiceStub(),
      renderComposite: vi.fn(),
      computeSections: vi.fn(),
      getScribeToken: vi.fn(),
      proxyService
    });

    const sender = makeSender(true); // destroyed
    ipcMain.get('proxy:generate')(
      { sender },
      { takeId: 'take-3', screenPath: '/proj/screen.webm', projectFolder: '/proj' }
    );

    await new Promise(r => setTimeout(r, 0));

    // 'started' is sent before await, before destruction check
    // 'done' should NOT be sent because sender.isDestroyed() returns true
    const calls = sender.send.mock.calls.map(c => c[1]?.status);
    expect(calls).not.toContain('done');
  });

  test('returns null if proxyService is not injected', () => {
    const ipcMain = makeIpcMain();

    registerIpcHandlers({
      ipcMain,
      app: { getPath: () => '/tmp' },
      dialog: { showOpenDialog: vi.fn() },
      desktopCapturer: { getSources: vi.fn() },
      shell: { openPath: vi.fn() },
      getWindow: () => null,
      screen: null,
      projectService: makeProjectServiceStub(),
      renderComposite: vi.fn(),
      computeSections: vi.fn(),
      getScribeToken: vi.fn()
      // proxyService intentionally omitted
    });

    const sender = makeSender();
    const result = ipcMain.get('proxy:generate')(
      { sender },
      { takeId: 'take-4', screenPath: '/proj/screen.webm', projectFolder: '/proj' }
    );

    expect(result).toBeNull();
  });
});
