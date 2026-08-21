import { EventEmitter } from 'node:events';

import { describe, expect, test, vi } from 'vitest';

import { runPackageSmoke, main } from '../../scripts/package-smoke-run.mjs';

function createFsFake({ readdirEntries = ['Loop-darwin-arm64'], readdirError = null } = {}) {
  const calls = [];
  return {
    calls,
    rm: vi.fn(async (target, options) => {
      calls.push(['rm', target, options]);
    }),
    readdir: vi.fn(async (target) => {
      calls.push(['readdir', target]);
      if (readdirError) {
        throw readdirError;
      }
      return readdirEntries;
    })
  };
}

class FakeProcess extends EventEmitter {
  exitCode = undefined;
}

describe('scripts/package-smoke-run runPackageSmoke', () => {
  test('cleans, packages, verifies non-empty output, then cleans up', async () => {
    const fs = createFsFake();
    const packagerCalls = [];
    const packager = vi.fn(async (options) => {
      packagerCalls.push(options);
      fs.calls.push(['packager']);
    });
    const createOptions = vi.fn(({ projectRoot, outDir }) => ({ dir: projectRoot, out: outDir }));

    await runPackageSmoke({
      packager,
      createOptions,
      fs,
      projectRoot: '/tmp/loop',
      outDir: '/tmp/loop/dist-smoke'
    });

    expect(createOptions).toHaveBeenCalledWith({
      projectRoot: '/tmp/loop',
      outDir: '/tmp/loop/dist-smoke'
    });
    expect(packagerCalls).toEqual([{ dir: '/tmp/loop', out: '/tmp/loop/dist-smoke' }]);
    expect(fs.calls).toEqual([
      ['rm', '/tmp/loop/dist-smoke', { recursive: true, force: true }],
      ['packager'],
      ['readdir', '/tmp/loop/dist-smoke'],
      ['rm', '/tmp/loop/dist-smoke', { recursive: true, force: true }]
    ]);
  });

  test('rejects when the packager resolves but the output directory is missing', async () => {
    const fs = createFsFake({ readdirError: new Error('ENOENT: no such file or directory') });

    await expect(
      runPackageSmoke({
        packager: async () => {},
        createOptions: (options) => options,
        fs,
        projectRoot: '/tmp/loop',
        outDir: '/tmp/loop/dist-smoke'
      })
    ).rejects.toThrow(/no output directory at \/tmp\/loop\/dist-smoke/);

    // The cleanup rm must not run: only the initial pre-package rm happened.
    expect(fs.rm).toHaveBeenCalledTimes(1);
  });

  test('rejects when the packager resolves but the output directory is empty', async () => {
    const fs = createFsFake({ readdirEntries: [] });

    await expect(
      runPackageSmoke({
        packager: async () => {},
        createOptions: (options) => options,
        fs,
        projectRoot: '/tmp/loop',
        outDir: '/tmp/loop/dist-smoke'
      })
    ).rejects.toThrow(/empty output directory at \/tmp\/loop\/dist-smoke/);
  });

  test('propagates packager rejection', async () => {
    const fs = createFsFake();

    await expect(
      runPackageSmoke({
        packager: async () => {
          throw new Error('packager exploded');
        },
        createOptions: (options) => options,
        fs,
        projectRoot: '/tmp/loop',
        outDir: '/tmp/loop/dist-smoke'
      })
    ).rejects.toThrow('packager exploded');
  });
});

describe('scripts/package-smoke-run main', () => {
  function createMainDeps({ packager, fs = createFsFake() } = {}) {
    const proc = new FakeProcess();
    const log = vi.fn();
    const logError = vi.fn();
    return {
      proc,
      log,
      logError,
      packager: packager ?? (async () => {}),
      createOptions: (options) => options,
      fs,
      projectRoot: '/tmp/loop',
      outDir: '/tmp/loop/dist-smoke'
    };
  }

  test('presets a failing exit code synchronously before packaging settles', () => {
    const deps = createMainDeps({ packager: () => new Promise(() => {}) });

    main(deps);

    expect(deps.proc.exitCode).toBe(1);
  });

  test('reports the drain diagnostic if the event loop drains while packaging is pending', () => {
    const deps = createMainDeps({ packager: () => new Promise(() => {}) });

    main(deps);
    deps.proc.emit('beforeExit');

    expect(deps.proc.exitCode).toBe(1);
    expect(deps.logError).toHaveBeenCalledWith(expect.stringContaining('did not complete'));
    expect(deps.log).not.toHaveBeenCalled();
  });

  test('resets the exit code to 0 and logs success only after verification passes', async () => {
    const deps = createMainDeps();

    await main(deps);

    expect(deps.proc.exitCode).toBe(0);
    expect(deps.log).toHaveBeenCalledWith('Packaging smoke succeeded');
    expect(deps.logError).not.toHaveBeenCalled();

    // A later beforeExit must not report a stale drain diagnostic.
    deps.proc.emit('beforeExit');
    expect(deps.logError).not.toHaveBeenCalled();
  });

  test('keeps a failing exit code and logs the error when packaging rejects', async () => {
    const deps = createMainDeps({
      packager: async () => {
        throw new Error('packager exploded');
      }
    });

    await main(deps);

    expect(deps.proc.exitCode).toBe(1);
    expect(deps.logError).toHaveBeenCalledWith('packager exploded');
    expect(deps.log).not.toHaveBeenCalled();

    deps.proc.emit('beforeExit');
    expect(deps.logError).toHaveBeenCalledTimes(1);
  });

  test('keeps a failing exit code when packaging succeeds but produces no output', async () => {
    const deps = createMainDeps({ fs: createFsFake({ readdirEntries: [] }) });

    await main(deps);

    expect(deps.proc.exitCode).toBe(1);
    expect(deps.logError).toHaveBeenCalledWith(expect.stringContaining('empty output directory'));
    expect(deps.log).not.toHaveBeenCalled();
  });
});
