import { describe, expect, test, vi } from 'vitest';

import { registerIpcHandlers } from '../../src/main/ipc/register-handlers';

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
    _resetQueue: vi.fn(),
  };
}

function registerWithHandlers() {
  const handlers = new Map<string, (event: unknown, payload: unknown) => unknown>();
  const ipcMain = {
    handle(channel: string, handler: (event: unknown, payload: unknown) => unknown) {
      handlers.set(channel, handler);
    }
  };
  const renderComposite = vi.fn(async (_opts: unknown, deps: { onProgress: (u: unknown) => void }) => {
    deps.onProgress({ phase: 'rendering', percent: 0.5, status: 'Rendering 50%' });
    return '/tmp/output.mp4';
  });
  const proxyService = createProxyServiceStub();

  registerIpcHandlers({
    ipcMain,
    app: { getPath: () => '/tmp' },
    dialog: { showOpenDialog: vi.fn() },
    desktopCapturer: { getSources: vi.fn() },
    shell: { openPath: vi.fn() },
    getWindow: () => null,
    projectService: createProjectServiceStub(),
    renderComposite,
    computeSections: vi.fn(),
    getScribeToken: vi.fn(),
    proxyService,
  } as unknown as Parameters<typeof registerIpcHandlers>[0]);

  return { handlers, renderComposite, proxyService };
}

describe('main/ipc/register-handlers', () => {
  test('render-composite forwards progress updates over IPC', async () => {
    const { handlers, renderComposite } = registerWithHandlers();

    const sender = { send: vi.fn() };
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

  test('proxy:generate returns derived proxy path and sends done on success', async () => {
    const { handlers } = registerWithHandlers();
    const sender = { send: vi.fn(), isDestroyed: vi.fn().mockReturnValue(false) };

    const result = handlers.get('proxy:generate')!(
      { sender },
      { takeId: 'take-1', screenPath: '/project/screen.webm', projectFolder: '/project', durationSec: 10 },
    );

    expect(result).toBe('/project/screen-proxy.mp4');
    expect(sender.send).toHaveBeenCalledWith('proxy:progress', { takeId: 'take-1', status: 'started', percent: 0 });

    // Wait for the background generation to complete
    await vi.waitFor(() => {
      expect(sender.send).toHaveBeenCalledWith('proxy:progress', {
        takeId: 'take-1',
        status: 'done',
        proxyPath: '/project/screen-proxy.mp4',
      });
    });
  });

  test('proxy:generate sends error on failure', async () => {
    const { handlers, proxyService } = registerWithHandlers();
    proxyService.generateProxy.mockRejectedValueOnce(new Error('encode failed'));
    const sender = { send: vi.fn(), isDestroyed: vi.fn().mockReturnValue(false) };

    handlers.get('proxy:generate')!(
      { sender },
      { takeId: 'take-1', screenPath: '/project/screen.webm', projectFolder: '/project' },
    );

    await vi.waitFor(() => {
      expect(sender.send).toHaveBeenCalledWith('proxy:progress', {
        takeId: 'take-1',
        status: 'error',
        error: 'encode failed',
      });
    });
  });

  test('proxy:generate does not send events when sender is destroyed', async () => {
    const { handlers, proxyService } = registerWithHandlers();
    proxyService.generateProxy.mockResolvedValueOnce(undefined);
    const sender = { send: vi.fn(), isDestroyed: vi.fn().mockReturnValue(true) };

    handlers.get('proxy:generate')!(
      { sender },
      { takeId: 'take-1', screenPath: '/project/screen.webm', projectFolder: '/project' },
    );

    // Wait for the promise to settle
    await new Promise((r) => setTimeout(r, 50));

    // Only the initial 'started' is sent before isDestroyed check in the .then()
    const doneCalls = sender.send.mock.calls.filter(
      (c: unknown[]) => c[0] === 'proxy:progress' && (c[1] as { status: string }).status === 'done',
    );
    expect(doneCalls).toHaveLength(0);
  });

  test('proxy:generate returns null when screenPath is missing', () => {
    const { handlers } = registerWithHandlers();
    const sender = { send: vi.fn(), isDestroyed: vi.fn().mockReturnValue(false) };

    const result = handlers.get('proxy:generate')!(
      { sender },
      { takeId: 'take-1', screenPath: '', projectFolder: '/project' },
    );

    expect(result).toBeNull();
  });
});
