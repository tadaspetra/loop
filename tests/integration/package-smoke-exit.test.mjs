import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, test } from 'vitest';

const fixturePath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  'fixtures/package-smoke-entry.fixture.mjs'
);

const tempDirs = [];

async function createTempOutDir() {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'loop-package-smoke-'));
  tempDirs.push(base);
  return path.join(base, 'dist-smoke');
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

function runFixture(mode, outDir) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [fixturePath, mode, outDir], {
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

describe('package smoke process exit behavior', () => {
  test('exits 1 with a drain diagnostic when the packager promise never settles', async () => {
    const outDir = await createTempOutDir();

    const result = await runFixture('hang', outDir);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('did not complete');
    expect(result.stdout).not.toContain('Packaging smoke succeeded');
  });

  test('exits 0 and logs success when packaging produces real output', async () => {
    const outDir = await createTempOutDir();

    const result = await runFixture('success', outDir);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('Packaging smoke succeeded');
    expect(result.stderr).toBe('');
    // The smoke output directory is cleaned up after verification.
    await expect(fs.access(outDir)).rejects.toThrow();
  });

  test('exits 1 when the packager resolves without producing output', async () => {
    const outDir = await createTempOutDir();

    const result = await runFixture('empty', outDir);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('no output directory');
    expect(result.stdout).not.toContain('Packaging smoke succeeded');
  });

  test('exits 1 with the error message when the packager rejects', async () => {
    const outDir = await createTempOutDir();

    const result = await runFixture('reject', outDir);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('packager exploded');
    expect(result.stdout).not.toContain('Packaging smoke succeeded');
  });
});
