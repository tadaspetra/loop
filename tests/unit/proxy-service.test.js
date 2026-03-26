const { EventEmitter } = require('events');
const { generateProxy, deriveProxyPath } = require('../../src/main/services/proxy-service');

// Each test needs a fresh module because the concurrency queue is module-level state.
// We re-require via a helper that resets the module registry.
function freshGenerateProxy() {
  // Clear the module from the cache so the queue resets between tests
  const key = require.resolve('../../src/main/services/proxy-service');
  delete require.cache[key];
  return require('../../src/main/services/proxy-service').generateProxy;
}

function makeFakeFs({ existsSync = () => false } = {}) {
  return {
    existsSync,
    unlinkSync: vi.fn(),
    renameSync: vi.fn()
  };
}

function makeRunFfmpeg(exitCode = 0, delay = 0) {
  return vi.fn(() => new Promise((resolve, reject) => {
    const settle = () => {
      if (exitCode === 0) resolve({ stderr: '' });
      else reject(new Error(`ffmpeg exited with code ${exitCode}`));
    };
    if (delay > 0) setTimeout(settle, delay);
    else settle();
  }));
}

describe('proxy-service — generateProxy', () => {
  test('happy path: ffmpeg exits 0 → renames .tmp to final path', async () => {
    const generateProxyFresh = freshGenerateProxy();
    const fakeFs = makeFakeFs();
    const fakeRun = makeRunFfmpeg(0);

    await generateProxyFresh(
      { screenPath: '/proj/screen.webm', proxyPath: '/proj/screen-proxy.mp4', ffmpegPath: '/ffmpeg' },
      { runFfmpeg: fakeRun, fs: fakeFs }
    );

    expect(fakeRun).toHaveBeenCalledOnce();
    const callArgs = fakeRun.mock.calls[0][0];
    expect(callArgs.args).toContain('/proj/screen.webm');
    expect(callArgs.args).toContain('/proj/screen-proxy.mp4.tmp');
    expect(fakeFs.renameSync).toHaveBeenCalledWith(
      '/proj/screen-proxy.mp4.tmp',
      '/proj/screen-proxy.mp4'
    );
    expect(fakeFs.unlinkSync).not.toHaveBeenCalled();
  });

  test('ffmpeg fails: .tmp is deleted and promise rejects', async () => {
    const generateProxyFresh = freshGenerateProxy();
    const fakeFs = makeFakeFs({ existsSync: (p) => p.endsWith('.tmp') });
    const fakeRun = makeRunFfmpeg(1);

    await expect(
      generateProxyFresh(
        { screenPath: '/proj/screen.webm', proxyPath: '/proj/screen-proxy.mp4', ffmpegPath: '/ffmpeg' },
        { runFfmpeg: fakeRun, fs: fakeFs }
      )
    ).rejects.toThrow();

    expect(fakeFs.unlinkSync).toHaveBeenCalledWith('/proj/screen-proxy.mp4.tmp');
    expect(fakeFs.renameSync).not.toHaveBeenCalled();
  });

  test('concurrency: 3 calls with max 2 → only 2 run at once, 3rd starts after first completes', async () => {
    const generateProxyFresh = freshGenerateProxy();
    const active = { count: 0, max: 0 };
    const resolvers = [];

    const fakeRun = vi.fn(() => new Promise((resolve) => {
      active.count += 1;
      active.max = Math.max(active.max, active.count);
      resolvers.push(() => { active.count -= 1; resolve({ stderr: '' }); });
    }));
    const fakeFs = makeFakeFs();

    const opts = (n) => ({ screenPath: `/proj/s${n}.webm`, proxyPath: `/proj/s${n}-proxy.mp4`, ffmpegPath: '/ffmpeg' });
    const deps = { runFfmpeg: fakeRun, fs: fakeFs };

    const p1 = generateProxyFresh(opts(1), deps);
    const p2 = generateProxyFresh(opts(2), deps);
    const p3 = generateProxyFresh(opts(3), deps);

    // Allow microtasks to settle so first 2 start
    await new Promise(r => setTimeout(r, 0));
    expect(fakeRun).toHaveBeenCalledTimes(2);

    // Complete job 1 → job 3 should start
    resolvers[0]();
    await new Promise(r => setTimeout(r, 0));
    expect(fakeRun).toHaveBeenCalledTimes(3);

    // Complete remaining
    resolvers[1]();
    resolvers[2]();
    await Promise.all([p1, p2, p3]);

    expect(active.max).toBe(2);
  });
});

describe('proxy-service — deriveProxyPath', () => {
  test('replaces .webm extension with -proxy.mp4', () => {
    expect(deriveProxyPath('/proj/recording-1710000000000-screen.webm'))
      .toBe('/proj/recording-1710000000000-screen-proxy.mp4');
  });

  test('works for arbitrary extensions', () => {
    expect(deriveProxyPath('/foo/bar.mkv')).toBe('/foo/bar-proxy.mp4');
  });
});
