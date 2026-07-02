import path from 'node:path';

import { describe, expect, test, vi } from 'vitest';

import {
  CLOSE_REQUESTED_CHANNEL,
  createWindow,
  type BrowserWindowConstructor
} from '../../src/main/app/create-window';
import type { CloseGuard } from '../../src/main/app/close-guard';

type CloseHandler = (event: { preventDefault: () => void }) => void;

function createCloseGuardStub(decision: 'allow' | 'prevent') {
  const guard = {
    setRecordingActive: vi.fn((_active: boolean) => {}),
    isRecordingActive: vi.fn(() => decision === 'prevent'),
    confirmClose: vi.fn(() => {}),
    handleCloseRequest: vi.fn(() => decision)
  };
  return guard satisfies CloseGuard;
}

function createGuardedWindow(closeGuard: CloseGuard, webContentsOverrides: object = {}) {
  const closeHandlers: CloseHandler[] = [];
  const webContents = {
    on: vi.fn(),
    setWindowOpenHandler: vi.fn(),
    send: vi.fn(),
    isDestroyed: vi.fn(() => false),
    ...webContentsOverrides
  };
  const browserWindowInstance = {
    webContents,
    loadFile: vi.fn(),
    setContentProtection: vi.fn(),
    close: vi.fn(),
    on: vi.fn((name: string, handler: CloseHandler) => {
      if (name === 'close') closeHandlers.push(handler);
    })
  };
  const BrowserWindow = vi.fn(function BrowserWindow() {
    return browserWindowInstance;
  }) as unknown as BrowserWindowConstructor;

  createWindow({ BrowserWindow, appRootDir: path.join('/tmp', 'loop-dist'), closeGuard });

  return { closeHandlers, webContents, browserWindowInstance };
}

describe('main/app/create-window', () => {
  test('uses the provided app root and applies hardened webPreferences', () => {
    const setWindowOpenHandler = vi.fn();
    const webContents = {
      on: vi.fn(),
      setWindowOpenHandler
    };
    const loadFile = vi.fn();
    const setContentProtection = vi.fn();
    const browserWindowInstance = {
      webContents,
      loadFile,
      setContentProtection
    };
    const BrowserWindow = vi.fn(function BrowserWindow() {
      return browserWindowInstance;
    }) as unknown as BrowserWindowConstructor;
    const appRootDir = path.join('/tmp', 'loop-dist');

    const win = createWindow({
      BrowserWindow,
      appRootDir
    });

    expect(BrowserWindow).toHaveBeenCalledWith(
      expect.objectContaining({
        webPreferences: expect.objectContaining({
          preload: path.join(appRootDir, 'preload.js'),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          webSecurity: true,
          allowRunningInsecureContent: false
        })
      })
    );
    expect(loadFile).toHaveBeenCalledWith(path.join(appRootDir, 'index.html'));
    expect(setContentProtection).toHaveBeenCalledWith(true);
    expect(setWindowOpenHandler).toHaveBeenCalledWith(expect.any(Function));
    expect(win).toBe(browserWindowInstance);
  });

  test('blocks external navigations and allows file:// ones', () => {
    const navigationHandlers: Array<(event: { preventDefault: () => void }, url: string) => void> =
      [];
    const webContents = {
      on: vi.fn((name: string, handler: (event: { preventDefault: () => void }, url: string) => void) => {
        if (name === 'will-navigate') navigationHandlers.push(handler);
      }),
      setWindowOpenHandler: vi.fn()
    };
    const browserWindowInstance = {
      webContents,
      loadFile: vi.fn(),
      setContentProtection: vi.fn()
    };
    const BrowserWindow = vi.fn(function BrowserWindow() {
      return browserWindowInstance;
    }) as unknown as BrowserWindowConstructor;

    createWindow({ BrowserWindow, appRootDir: path.join('/tmp', 'loop-dist') });

    expect(navigationHandlers).toHaveLength(1);
    const handler = navigationHandlers[0];

    const httpEvent = { preventDefault: vi.fn() };
    handler(httpEvent, 'https://example.com');
    expect(httpEvent.preventDefault).toHaveBeenCalled();

    const invalidEvent = { preventDefault: vi.fn() };
    handler(invalidEvent, 'not a url');
    expect(invalidEvent.preventDefault).toHaveBeenCalled();

    const fileEvent = { preventDefault: vi.fn() };
    handler(fileEvent, 'file:///Users/me/project/index.html');
    expect(fileEvent.preventDefault).not.toHaveBeenCalled();
  });

  test('window open handler denies every request', () => {
    let captured: (() => { action: string }) | null = null;
    const webContents = {
      on: vi.fn(),
      setWindowOpenHandler: vi.fn((fn: () => { action: string }) => {
        captured = fn;
      })
    };
    const BrowserWindow = vi.fn(function BrowserWindow() {
      return {
        webContents,
        loadFile: vi.fn(),
        setContentProtection: vi.fn()
      };
    }) as unknown as BrowserWindowConstructor;

    createWindow({ BrowserWindow, appRootDir: path.join('/tmp', 'loop-dist') });

    expect(captured).not.toBeNull();
    expect(captured!()).toEqual({ action: 'deny' });
  });

  test('close is prevented and the renderer notified while recording is active', () => {
    const closeGuard = createCloseGuardStub('prevent');
    const { closeHandlers, webContents, browserWindowInstance } = createGuardedWindow(closeGuard);

    expect(closeHandlers).toHaveLength(1);
    const event = { preventDefault: vi.fn() };
    closeHandlers[0](event);

    expect(closeGuard.handleCloseRequest).toHaveBeenCalled();
    expect(event.preventDefault).toHaveBeenCalled();
    expect(webContents.send).toHaveBeenCalledWith(CLOSE_REQUESTED_CHANNEL);
    // The window itself is not force-closed; the renderer drives the real
    // close after stop/finalize via app:confirm-close.
    expect(browserWindowInstance.close).not.toHaveBeenCalled();
  });

  test('close proceeds untouched when the guard allows it', () => {
    const closeGuard = createCloseGuardStub('allow');
    const { closeHandlers, webContents } = createGuardedWindow(closeGuard);

    const event = { preventDefault: vi.fn() };
    closeHandlers[0](event);

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(webContents.send).not.toHaveBeenCalled();
  });

  test('close proceeds when the renderer cannot be notified (destroyed webContents)', () => {
    const closeGuard = createCloseGuardStub('prevent');
    const { closeHandlers, webContents } = createGuardedWindow(closeGuard, {
      isDestroyed: vi.fn(() => true)
    });

    const event = { preventDefault: vi.fn() };
    closeHandlers[0](event);

    // Nobody can finalize + confirm the close, and the bytes are already in
    // the .part files, so the close must not be blocked forever.
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(webContents.send).not.toHaveBeenCalled();
  });

  test('falls back to a confirmed close when notifying the renderer throws', () => {
    const closeGuard = createCloseGuardStub('prevent');
    const send = vi.fn(() => {
      throw new Error('render frame disposed');
    });
    const { closeHandlers, browserWindowInstance } = createGuardedWindow(closeGuard, { send });

    const event = { preventDefault: vi.fn() };
    closeHandlers[0](event);

    expect(event.preventDefault).toHaveBeenCalled();
    expect(closeGuard.confirmClose).toHaveBeenCalled();
    expect(browserWindowInstance.close).toHaveBeenCalled();
  });

  test('windows created without a close guard do not intercept close', () => {
    const closeHandlers: CloseHandler[] = [];
    const browserWindowInstance = {
      webContents: { on: vi.fn(), setWindowOpenHandler: vi.fn() },
      loadFile: vi.fn(),
      setContentProtection: vi.fn(),
      on: vi.fn((name: string, handler: CloseHandler) => {
        if (name === 'close') closeHandlers.push(handler);
      })
    };
    const BrowserWindow = vi.fn(function BrowserWindow() {
      return browserWindowInstance;
    }) as unknown as BrowserWindowConstructor;

    createWindow({ BrowserWindow, appRootDir: path.join('/tmp', 'loop-dist') });

    expect(closeHandlers).toHaveLength(0);
  });
});
