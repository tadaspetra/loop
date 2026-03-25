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

describe('main/ipc/register-handlers', () => {
  test('render-composite forwards progress updates over IPC', async () => {
    const handlers = new Map<string, (event: unknown, payload: unknown) => Promise<unknown>>();
    const ipcMain = {
      handle(channel: string, handler: (event: unknown, payload: unknown) => Promise<unknown>) {
        handlers.set(channel, handler);
      }
    };
    const renderComposite = vi.fn(async (_opts: unknown, deps: { onProgress: (u: unknown) => void }) => {
      deps.onProgress({ phase: 'rendering', percent: 0.5, status: 'Rendering 50%' });
      return '/tmp/output.mp4';
    });

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
      getScribeToken: vi.fn()
    } as unknown as Parameters<typeof registerIpcHandlers>[0]);

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
});
