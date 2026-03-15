import { describe, expect, test } from 'vitest';
import {
  computeCameraPlaybackDrift,
  normalizeCameraSyncOffsetMs,
  resolveCameraPlaybackTargetTime
} from '../../src/renderer/features/timeline/camera-sync.js';

describe('renderer/features/timeline/camera-sync', () => {
  test('normalizeCameraSyncOffsetMs rounds and clamps the playback offset', () => {
    expect(normalizeCameraSyncOffsetMs()).toBe(0);
    expect(normalizeCameraSyncOffsetMs(118.6)).toBe(119);
    expect(normalizeCameraSyncOffsetMs(-5000)).toBe(-2000);
    expect(normalizeCameraSyncOffsetMs(5000)).toBe(2000);
  });

  test('resolveCameraPlaybackTargetTime advances late camera video', () => {
    expect(resolveCameraPlaybackTargetTime(3, 120)).toBeCloseTo(3.12, 5);
    expect(resolveCameraPlaybackTargetTime(0.05, -120)).toBe(0);
  });

  test('computeCameraPlaybackDrift compares camera time against the offset target', () => {
    expect(computeCameraPlaybackDrift(5, 5, 120)).toBeCloseTo(0.12, 5);
    expect(computeCameraPlaybackDrift(5, 5.1, 120)).toBeCloseTo(0.02, 5);
  });
});
