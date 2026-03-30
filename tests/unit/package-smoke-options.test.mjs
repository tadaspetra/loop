import { describe, expect, test } from 'vitest';

import { createPackagerOptions } from '../../scripts/package-smoke-options.mjs';

describe('scripts/package-smoke-options', () => {
  test('disables pruning so packaging smoke works with pnpm installs', () => {
    const options = createPackagerOptions({
      projectRoot: '/tmp/loop',
      outDir: '/tmp/loop/dist-smoke',
      platform: 'linux',
      arch: 'x64'
    });

    expect(options).toMatchObject({
      dir: '/tmp/loop',
      out: '/tmp/loop/dist-smoke',
      overwrite: true,
      platform: 'linux',
      arch: 'x64',
      prune: false,
      quiet: true
    });
  });

  test('ignores non-package inputs and the smoke output directory', () => {
    const options = createPackagerOptions({
      projectRoot: '/tmp/loop',
      outDir: '/tmp/loop/dist-smoke'
    });

    const ignoredPaths = [
      '/tests/smoke.test.ts',
      '/docs/runbook.md',
      '/coverage/index.html',
      '/.github/workflows/ci.yml',
      '/tmp/cache.json',
      '/dist-smoke/Loop-darwin-x64'
    ];

    for (const ignoredPath of ignoredPaths) {
      expect(options.ignore.some((pattern) => pattern.test(ignoredPath))).toBe(true);
    }

    expect(options.ignore.some((pattern) => pattern.test('/src/main.ts'))).toBe(false);
  });
});
