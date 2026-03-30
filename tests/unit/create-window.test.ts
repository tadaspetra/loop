import path from 'node:path';

import { describe, expect, test, vi } from 'vitest';

import { createWindow, type BrowserWindowConstructor } from '../../src/main/app/create-window';

describe('main/app/create-window', () => {
  test('uses the provided app root for preload and html paths', () => {
    const webContents = {
      on: vi.fn()
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
          preload: path.join(appRootDir, 'preload.js')
        })
      })
    );
    expect(loadFile).toHaveBeenCalledWith(path.join(appRootDir, 'index.html'));
    expect(setContentProtection).toHaveBeenCalledWith(true);
    expect(win).toBe(browserWindowInstance);
  });
});
