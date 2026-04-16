import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import {
  _resetForTests,
  appendRecordingChunk,
  beginRecording,
  cancelRecording,
  computeRecordingPaths,
  discardOrphanRecording,
  finalizeRecording,
  findOrphanRecordingParts,
  getActiveRecordingCount,
  recoverOrphanRecording,
  scanOrphanRecordings
} from '../../src/main/services/recording-service';

function createSandbox() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'video-recording-service-'));
  return {
    root,
    cleanup() {
      fs.rmSync(root, { recursive: true, force: true });
    }
  };
}

describe('main/services/recording-service', () => {
  let sandbox: ReturnType<typeof createSandbox>;

  beforeEach(() => {
    sandbox = createSandbox();
  });

  afterEach(() => {
    _resetForTests();
    sandbox.cleanup();
  });

  test('computeRecordingPaths produces stable final names and unique temp names', () => {
    const a = computeRecordingPaths(sandbox.root, 'take-1', 'screen');
    const b = computeRecordingPaths(sandbox.root, 'take-1', 'screen');
    expect(a.finalPath).toBe(path.join(sandbox.root, 'recording-take-1-screen.webm'));
    expect(b.finalPath).toBe(a.finalPath);
    expect(a.tempPath).not.toBe(b.tempPath);
    expect(path.basename(a.tempPath)).toMatch(/^\.recording-take-1-screen-[0-9a-f]{6}\.webm\.part$/);
  });

  test('begin/append/finalize streams bytes to disk and renames on finish', async () => {
    const { tempPath, finalPath } = beginRecording({
      takeId: 'take-1',
      suffix: 'screen',
      folder: sandbox.root
    });
    expect(fs.existsSync(tempPath)).toBe(true);
    expect(getActiveRecordingCount()).toBe(1);

    await appendRecordingChunk({
      takeId: 'take-1',
      suffix: 'screen',
      data: Buffer.from([1, 2, 3])
    });
    await appendRecordingChunk({
      takeId: 'take-1',
      suffix: 'screen',
      data: new Uint8Array([4, 5]).buffer
    });
    await appendRecordingChunk({
      takeId: 'take-1',
      suffix: 'screen',
      data: new Uint8Array([6, 7, 8])
    });

    const result = finalizeRecording({ takeId: 'take-1', suffix: 'screen' });
    expect(result.path).toBe(finalPath);
    expect(result.bytesWritten).toBe(8);
    expect(getActiveRecordingCount()).toBe(0);
    expect(fs.existsSync(finalPath)).toBe(true);
    expect(fs.existsSync(tempPath)).toBe(false);
    expect(fs.readFileSync(finalPath)).toEqual(Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]));
  });

  test('finalize with zero bytes throws and removes the temp file', () => {
    const { tempPath } = beginRecording({
      takeId: 'take-empty',
      suffix: 'screen',
      folder: sandbox.root
    });

    expect(() => finalizeRecording({ takeId: 'take-empty', suffix: 'screen' })).toThrow(
      /produced no data/i
    );
    expect(fs.existsSync(tempPath)).toBe(false);
    expect(getActiveRecordingCount()).toBe(0);
  });

  test('cancel closes and removes the temp file even when bytes have been written', async () => {
    const { tempPath } = beginRecording({
      takeId: 'take-cancel',
      suffix: 'camera',
      folder: sandbox.root
    });
    await appendRecordingChunk({
      takeId: 'take-cancel',
      suffix: 'camera',
      data: Buffer.from('abc')
    });
    const result = cancelRecording({ takeId: 'take-cancel', suffix: 'camera' });
    expect(result.cancelled).toBe(true);
    expect(fs.existsSync(tempPath)).toBe(false);
    expect(getActiveRecordingCount()).toBe(0);
  });

  test('begin rejects duplicate active recordings for the same take/suffix', () => {
    beginRecording({ takeId: 'take-dup', suffix: 'screen', folder: sandbox.root });
    expect(() =>
      beginRecording({ takeId: 'take-dup', suffix: 'screen', folder: sandbox.root })
    ).toThrow(/already in progress/i);
  });

  test('append rejects unknown handles and finalize fails after close', async () => {
    await expect(
      appendRecordingChunk({ takeId: 'nope', suffix: 'screen', data: Buffer.from('x') })
    ).rejects.toThrow(/no active recording/i);

    beginRecording({ takeId: 'take-once', suffix: 'screen', folder: sandbox.root });
    await appendRecordingChunk({
      takeId: 'take-once',
      suffix: 'screen',
      data: Buffer.from('y')
    });
    const first = finalizeRecording({ takeId: 'take-once', suffix: 'screen' });
    expect(fs.existsSync(first.path)).toBe(true);
    // Finalize is a one-shot operation. Once the handle is gone, a second call
    // surfaces an explicit error so callers (and our tests) never silently
    // rename/overwrite the final file.
    expect(() => finalizeRecording({ takeId: 'take-once', suffix: 'screen' })).toThrow(
      /no active recording/i
    );
  });

  test('findOrphanRecordingParts surfaces .part files for post-crash recovery', () => {
    // Simulate a crash: the main process exited before finalize/cancel, so the
    // temp .part file is still on disk. We create it directly (bypassing the
    // in-memory handle) to mirror what the OS leaves behind when the process
    // is killed.
    const orphanPath = path.join(
      sandbox.root,
      '.recording-take-orphan-screen-abc123.webm.part'
    );
    fs.writeFileSync(orphanPath, 'partial-bytes');

    const orphans = findOrphanRecordingParts(sandbox.root);
    expect(orphans).toHaveLength(1);
    expect(orphans[0]).toBe(orphanPath);
  });

  test('findOrphanRecordingParts returns empty array for missing folders', () => {
    expect(findOrphanRecordingParts(path.join(sandbox.root, 'does-not-exist'))).toEqual([]);
  });

  test('scanOrphanRecordings groups screen+camera .part files by takeId', () => {
    const screenPath = path.join(
      sandbox.root,
      '.recording-take-1700000000000-screen-aaaaaa.webm.part'
    );
    const cameraPath = path.join(
      sandbox.root,
      '.recording-take-1700000000000-camera-bbbbbb.webm.part'
    );
    const otherScreen = path.join(
      sandbox.root,
      '.recording-take-1800000000000-screen-cccccc.webm.part'
    );
    fs.writeFileSync(screenPath, Buffer.alloc(1024));
    fs.writeFileSync(cameraPath, Buffer.alloc(256));
    fs.writeFileSync(otherScreen, Buffer.alloc(42));
    // Stray file that does not match the orphan pattern should be ignored.
    fs.writeFileSync(path.join(sandbox.root, 'not-an-orphan.webm.part'), 'x');

    const candidates = scanOrphanRecordings(sandbox.root);
    expect(candidates).toHaveLength(2);
    // Sorted oldest-first by derived createdAt.
    expect(candidates[0].takeId).toBe('take-1700000000000');
    expect(candidates[0].screen?.partPath).toBe(screenPath);
    expect(candidates[0].screen?.bytes).toBe(1024);
    expect(candidates[0].camera?.partPath).toBe(cameraPath);
    expect(candidates[0].camera?.bytes).toBe(256);
    expect(candidates[0].createdAt).toBe('2023-11-14T22:13:20.000Z');

    expect(candidates[1].takeId).toBe('take-1800000000000');
    expect(candidates[1].screen?.partPath).toBe(otherScreen);
    expect(candidates[1].camera).toBeNull();
  });

  test('recoverOrphanRecording renames the .part files into final names', () => {
    const screenPart = path.join(
      sandbox.root,
      '.recording-take-1700000000000-screen-aaaaaa.webm.part'
    );
    const cameraPart = path.join(
      sandbox.root,
      '.recording-take-1700000000000-camera-bbbbbb.webm.part'
    );
    fs.writeFileSync(screenPart, 'screen-bytes');
    fs.writeFileSync(cameraPart, 'camera-bytes');

    const result = recoverOrphanRecording(sandbox.root, 'take-1700000000000');
    expect(result).not.toBeNull();
    expect(result!.takeId).toBe('take-1700000000000');
    expect(result!.screenPath).toBe(
      path.join(sandbox.root, 'recording-take-1700000000000-screen.webm')
    );
    expect(result!.cameraPath).toBe(
      path.join(sandbox.root, 'recording-take-1700000000000-camera.webm')
    );
    expect(fs.existsSync(screenPart)).toBe(false);
    expect(fs.existsSync(cameraPart)).toBe(false);
    expect(fs.existsSync(result!.screenPath!)).toBe(true);
    expect(fs.existsSync(result!.cameraPath!)).toBe(true);
  });

  test('recoverOrphanRecording returns null when screen bytes are missing', () => {
    const cameraPart = path.join(
      sandbox.root,
      '.recording-take-1700000000000-camera-aaaaaa.webm.part'
    );
    fs.writeFileSync(cameraPart, 'camera-only');

    const result = recoverOrphanRecording(sandbox.root, 'take-1700000000000');
    expect(result).toBeNull();
    // Camera-only fragments are cleaned up since they are unusable without a
    // screen recording.
    expect(fs.existsSync(cameraPart)).toBe(false);
  });

  test('recoverOrphanRecording returns null for unknown takeIds', () => {
    expect(recoverOrphanRecording(sandbox.root, 'take-does-not-exist')).toBeNull();
  });

  test('discardOrphanRecording removes every .part file for a takeId', () => {
    const screenPart = path.join(
      sandbox.root,
      '.recording-take-1700000000000-screen-aaaaaa.webm.part'
    );
    const cameraPart = path.join(
      sandbox.root,
      '.recording-take-1700000000000-camera-bbbbbb.webm.part'
    );
    fs.writeFileSync(screenPart, 'x');
    fs.writeFileSync(cameraPart, 'y');

    const result = discardOrphanRecording(sandbox.root, 'take-1700000000000');
    expect(result.discarded).toBe(2);
    expect(fs.existsSync(screenPart)).toBe(false);
    expect(fs.existsSync(cameraPart)).toBe(false);
  });
});
