import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, test } from 'vitest';

import {
  ensureDirectory,
  isDirectoryEmpty,
  readJsonFile,
  safeUnlink,
  writeJsonFile
} from '../../src/main/infra/file-system';

describe('main/infra/file-system', () => {
  test('writeJsonFile and readJsonFile round-trip data', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'video-fs-test-'));
    const file = path.join(root, 'nested', 'data.json');
    writeJsonFile(file, { ok: true, count: 3 });
    const result = readJsonFile(file, null);
    expect(result).toEqual({ ok: true, count: 3 });
  });

  test('ensureDirectory creates folders recursively', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'video-fs-dir-'));
    const folder = path.join(root, 'a', 'b', 'c');
    ensureDirectory(folder);
    expect(fs.existsSync(folder)).toBe(true);
  });

  test('isDirectoryEmpty and safeUnlink behave safely', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'video-fs-empty-'));
    const file = path.join(root, 'file.txt');
    expect(isDirectoryEmpty(root)).toBe(true);
    fs.writeFileSync(file, 'x', 'utf8');
    expect(isDirectoryEmpty(root)).toBe(false);
    safeUnlink(file);
    expect(fs.existsSync(file)).toBe(false);
  });
});
