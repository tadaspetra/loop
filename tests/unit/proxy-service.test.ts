import { describe, expect, test, vi, beforeEach } from 'vitest';

import {
  deriveProxyPath,
  generateProxy,
  isCurrentProxyPath,
  _getQueueState,
  _resetQueue
} from '../../src/main/services/proxy-service';

describe('main/services/proxy-service', () => {
  beforeEach(() => {
    _resetQueue();
  });

  test('deriveProxyPath uses the versioned -proxy-v2.mp4 suffix so older proxies are treated as cache misses', () => {
    expect(deriveProxyPath('/project/recording-123-screen.webm')).toBe(
      '/project/recording-123-screen-proxy-v2.mp4'
    );
  });

  test('deriveProxyPath handles paths without extension', () => {
    expect(deriveProxyPath('/project/recording')).toBe('/project/recording-proxy-v2.mp4');
  });

  test('isCurrentProxyPath distinguishes v2 proxies from legacy -proxy.mp4 files', () => {
    expect(isCurrentProxyPath('/project/screen-proxy-v2.mp4')).toBe(true);
    // Legacy proxies (pre-v2) are the ones that did CFR timestamp
    // normalization and therefore cannot be mixed with raw camera playback;
    // treat them as outdated so the renderer schedules a fresh proxy.
    expect(isCurrentProxyPath('/project/screen-proxy.mp4')).toBe(false);
    expect(isCurrentProxyPath(null)).toBe(false);
    expect(isCurrentProxyPath(undefined)).toBe(false);
    expect(isCurrentProxyPath('')).toBe(false);
  });

  test('generateProxy produces a PTS-preserving scale-only H.264 proxy (no CFR normalization)', async () => {
    const runFfmpeg = vi.fn().mockResolvedValue({ stderr: '' });
    const fsStub = {
      existsSync: vi.fn().mockReturnValue(false),
      unlinkSync: vi.fn(),
      renameSync: vi.fn()
    };

    await generateProxy(
      { screenPath: '/project/screen.webm', proxyPath: '/project/screen-proxy-v2.mp4' },
      { runFfmpeg, fs: fsStub, ffmpegPath: '/usr/bin/ffmpeg' }
    );

    expect(runFfmpeg).toHaveBeenCalledOnce();
    const callArgs = runFfmpeg.mock.calls[0][0];
    expect(callArgs.ffmpegPath).toBe('/usr/bin/ffmpeg');
    expect(callArgs.args).toContain('-i');
    expect(callArgs.args).toContain('/project/screen.webm');
    expect(callArgs.args).toContain('/project/screen-proxy-v2.mp4.tmp');
    expect(callArgs.args).toContain('libx264');
    expect(callArgs.args).toContain('-fflags');
    expect(callArgs.args).toContain('+genpts');
    // The proxy must pass input timestamps straight through so its
    // currentTime axis matches the raw camera WebM in the editor loop.
    // Anything that forces CFR here (fps=N, -r N, fps_mode=cfr, setpts)
    // would reintroduce the drift the editor had on long recordings.
    expect(callArgs.args).toContain('-fps_mode');
    expect(callArgs.args).toContain('passthrough');
    expect(callArgs.args).not.toContain('-r');
    expect(callArgs.args).not.toContain('cfr');
    expect(callArgs.args[callArgs.args.indexOf('-vf') + 1]).toBe('scale=960:540');
    // Double-check we didn't leave the CFR normalization filters in place.
    expect(callArgs.args.join(' ')).not.toContain('fps=30');
    expect(callArgs.args.join(' ')).not.toContain('setpts=N/(30*TB)');

    expect(fsStub.renameSync).toHaveBeenCalledWith(
      '/project/screen-proxy-v2.mp4.tmp',
      '/project/screen-proxy-v2.mp4'
    );
  });

  test('generateProxy forwards onProgress to runFfmpeg', async () => {
    const onProgress = vi.fn();
    const runFfmpeg = vi.fn().mockResolvedValue({ stderr: '' });
    const fsStub = {
      existsSync: vi.fn().mockReturnValue(false),
      unlinkSync: vi.fn(),
      renameSync: vi.fn()
    };

    await generateProxy(
      { screenPath: '/project/screen.webm', proxyPath: '/project/screen-proxy.mp4', onProgress },
      { runFfmpeg, fs: fsStub, ffmpegPath: '/usr/bin/ffmpeg' }
    );

    expect(runFfmpeg.mock.calls[0][0].onProgress).toBe(onProgress);
  });

  test('generateProxy deletes tmp file on failure', async () => {
    const runFfmpeg = vi.fn().mockRejectedValue(new Error('ffmpeg failed'));
    const fsStub = {
      existsSync: vi.fn().mockReturnValue(true),
      unlinkSync: vi.fn(),
      renameSync: vi.fn()
    };

    await expect(
      generateProxy(
        { screenPath: '/project/screen.webm', proxyPath: '/project/screen-proxy.mp4' },
        { runFfmpeg, fs: fsStub, ffmpegPath: '/usr/bin/ffmpeg' }
      )
    ).rejects.toThrow('ffmpeg failed');

    expect(fsStub.unlinkSync).toHaveBeenCalledWith('/project/screen-proxy.mp4.tmp');
    expect(fsStub.renameSync).not.toHaveBeenCalled();
  });

  test('generateProxy cleans up stale tmp before starting', async () => {
    const runFfmpeg = vi.fn().mockResolvedValue({ stderr: '' });
    const fsStub = {
      existsSync: vi.fn().mockReturnValue(true),
      unlinkSync: vi.fn(),
      renameSync: vi.fn()
    };

    await generateProxy(
      { screenPath: '/project/screen.webm', proxyPath: '/project/screen-proxy.mp4' },
      { runFfmpeg, fs: fsStub, ffmpegPath: '/usr/bin/ffmpeg' }
    );

    // First call to unlinkSync is the stale tmp cleanup
    expect(fsStub.unlinkSync).toHaveBeenCalledWith('/project/screen-proxy.mp4.tmp');
  });

  test('concurrency queue limits to 2 simultaneous jobs', async () => {
    let resolveA: () => void;
    let resolveB: () => void;
    let resolveC: () => void;
    const promiseA = new Promise<{ stderr: string }>((r) => {
      resolveA = () => r({ stderr: '' });
    });
    const promiseB = new Promise<{ stderr: string }>((r) => {
      resolveB = () => r({ stderr: '' });
    });
    const promiseC = new Promise<{ stderr: string }>((r) => {
      resolveC = () => r({ stderr: '' });
    });

    const runFfmpeg = vi
      .fn()
      .mockReturnValueOnce(promiseA)
      .mockReturnValueOnce(promiseB)
      .mockReturnValueOnce(promiseC);

    const fsStub = {
      existsSync: vi.fn().mockReturnValue(false),
      unlinkSync: vi.fn(),
      renameSync: vi.fn()
    };
    const deps = { runFfmpeg, fs: fsStub, ffmpegPath: '/usr/bin/ffmpeg' };

    const a = generateProxy({ screenPath: '/a.webm', proxyPath: '/a-proxy.mp4' }, deps);
    const b = generateProxy({ screenPath: '/b.webm', proxyPath: '/b-proxy.mp4' }, deps);
    const c = generateProxy({ screenPath: '/c.webm', proxyPath: '/c-proxy.mp4' }, deps);

    // Allow microtasks to run
    await vi.waitFor(() => {
      expect(runFfmpeg).toHaveBeenCalledTimes(2);
    });

    // Only 2 should be active, third is queued
    expect(_getQueueState().activeCount).toBe(2);
    expect(_getQueueState().queueLength).toBe(1);

    // Complete first job, third should start
    resolveA!();
    await vi.waitFor(() => {
      expect(runFfmpeg).toHaveBeenCalledTimes(3);
    });

    resolveB!();
    resolveC!();
    await Promise.all([a, b, c]);
  });
});
