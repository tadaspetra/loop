import { describe, test, expect, vi, beforeEach } from 'vitest';

// We need to test the cleanupMouseTrailTimer function exported from register-handlers.
// Since register-handlers uses require('electron'), we mock the module environment.

describe('cleanupMouseTrailTimer', () => {
  let cleanupMouseTrailTimer;
  let handlers;

  beforeEach(() => {
    handlers = new Map();
    const ipcMain = {
      handle(channel, handler) {
        handlers.set(channel, handler);
      }
    };

    // Dynamic import with mocked ipcMain to register handlers and get cleanup fn
    const { registerIpcHandlers } = require('../../src/main/ipc/register-handlers');
    const result = registerIpcHandlers({
      ipcMain,
      app: { getPath: () => '/tmp' },
      dialog: { showOpenDialog: vi.fn() },
      desktopCapturer: { getSources: vi.fn() },
      shell: { openPath: vi.fn() },
      getWindow: () => null,
      screen: { getCursorScreenPoint: () => ({ x: 0, y: 0 }) },
      projectService: {
        sanitizeProjectName: (name) => name,
        createProject: vi.fn(),
        openProject: vi.fn(),
        saveProject: vi.fn(),
        setRecoveryTake: vi.fn(),
        clearRecoveryByProject: vi.fn(),
        completeRecoveryByProject: vi.fn(),
        listRecentProjects: vi.fn(),
        loadLastProject: vi.fn(),
        setLastProject: vi.fn(),
        saveVideo: vi.fn(),
        saveMouseTrail: vi.fn()
      },
      renderComposite: vi.fn(),
      computeSections: vi.fn(),
      getScribeToken: vi.fn()
    });

    cleanupMouseTrailTimer = result.cleanupMouseTrailTimer;
  });

  // Task 4.2: clears active timer and resets samples
  test('clears active timer and resets samples', async () => {
    // Start a mouse trail to create an active timer
    await handlers.get('start-mouse-trail')({});

    // Cleanup should clear it
    cleanupMouseTrailTimer();

    // Stopping again should return empty samples (timer was already cleared)
    const samples = await handlers.get('stop-mouse-trail')({});
    expect(samples).toEqual([]);
  });

  // Task 4.3: called with no active timer does not throw
  test('called with no active timer does not throw', () => {
    expect(() => cleanupMouseTrailTimer()).not.toThrow();
  });

  test('called twice does not throw', async () => {
    await handlers.get('start-mouse-trail')({});
    cleanupMouseTrailTimer();
    expect(() => cleanupMouseTrailTimer()).not.toThrow();
  });
});
