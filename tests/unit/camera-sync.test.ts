import { describe, expect, test } from 'vitest';

import {
  computeCameraPlaybackDrift,
  computePlaybackSeekPlan,
  decideCameraSyncAction,
  DEFAULT_CAMERA_SYNC_THRESHOLDS,
  normalizeCameraSyncOffsetMs,
  resolveCameraPlaybackTargetTime
} from '../../src/renderer/features/timeline/camera-sync';

describe('renderer/features/timeline/camera-sync', () => {
  test('normalizeCameraSyncOffsetMs rounds and clamps the playback offset', () => {
    expect(normalizeCameraSyncOffsetMs(undefined)).toBe(0);
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

  test('computePlaybackSeekPlan seeks camera even when screen is already aligned', () => {
    expect(computePlaybackSeekPlan(4, 4, 4, 120)).toEqual({
      targetSourceTime: 4,
      targetCameraTime: 4.12,
      screenNeedsSeek: false,
      cameraNeedsSeek: true,
      needsSeek: true
    });
  });

  test('computePlaybackSeekPlan skips seeks when screen and camera already match targets', () => {
    expect(computePlaybackSeekPlan(4, 4.12, 4, 120)).toEqual({
      targetSourceTime: 4,
      targetCameraTime: 4.12,
      screenNeedsSeek: false,
      cameraNeedsSeek: false,
      needsSeek: false
    });
  });

  describe('decideCameraSyncAction', () => {
    const baseInput = {
      drift: 0,
      baseRate: 1,
      currentPlaybackRate: 1,
      targetCameraTime: 0,
      nowMs: 10_000,
      resyncCooldownUntil: 0,
      suppressedUntil: 0
    };

    test('returns "none" while inside the post-seek suppression window', () => {
      // Large drift (250ms) that would normally trigger a soft rate tweak —
      // but the suppression window means that drift is almost certainly seek
      // latency, not a real desync. We must not touch currentTime or
      // playbackRate here or we'll thrash the camera decoder.
      const action = decideCameraSyncAction({
        ...baseInput,
        drift: 0.25,
        nowMs: 10_000,
        suppressedUntil: 10_200
      });
      expect(action.kind).toBe('none');
    });

    test('does not hard-resync during the cooldown window even when drift is huge', () => {
      const action = decideCameraSyncAction({
        ...baseInput,
        drift: 1.0,
        nowMs: 10_000,
        resyncCooldownUntil: 10_500
      });
      // Cooldown blocks hard resync; drift > softThreshold still allows a
      // soft rate correction to keep easing the drift toward zero.
      expect(action.kind).toBe('softRate');
    });

    test('hard-resyncs and extends the cooldown when drift exceeds the hard threshold', () => {
      const action = decideCameraSyncAction({
        ...baseInput,
        drift: 0.4,
        targetCameraTime: 5.4,
        nowMs: 20_000,
        resyncCooldownUntil: 0
      });
      expect(action.kind).toBe('hardResync');
      expect(action.targetCameraTime).toBe(5.4);
      expect(action.targetPlaybackRate).toBe(1);
      expect(action.nextResyncCooldownUntil).toBe(
        20_000 + DEFAULT_CAMERA_SYNC_THRESHOLDS.resyncCooldownMs
      );
    });

    test('returns "none" for tiny drift under the soft threshold', () => {
      // Previously this range produced audible pitch wobble from per-frame
      // rate nudges without measurably improving sync. It is now a no-op.
      const smallDrift = DEFAULT_CAMERA_SYNC_THRESHOLDS.softThreshold - 0.001;
      const action = decideCameraSyncAction({ ...baseInput, drift: smallDrift });
      expect(action.kind).toBe('none');
    });

    test('soft-rate correction clamps the proposed rate to ±maxRateCorrection of baseRate', () => {
      // Drift well past any clamp cap so the correction hits the max.
      const action = decideCameraSyncAction({
        ...baseInput,
        drift: 0.2,
        baseRate: 1
      });
      expect(action.kind).toBe('softRate');
      expect(action.targetPlaybackRate).toBe(1 + DEFAULT_CAMERA_SYNC_THRESHOLDS.maxRateCorrection);
    });

    test('soft-rate skip when proposed rate is within minRateChange of the current rate', () => {
      // Drift just over the soft threshold; proposed correction is tiny.
      // The minRateChange guard should suppress the write so the playbackRate
      // setter does not fire every frame for imperceptible changes.
      const action = decideCameraSyncAction({
        ...baseInput,
        drift: DEFAULT_CAMERA_SYNC_THRESHOLDS.softThreshold + 0.001,
        currentPlaybackRate: 1 + DEFAULT_CAMERA_SYNC_THRESHOLDS.softThreshold / 2
      });
      expect(action.kind).toBe('none');
    });

    test('rate reset fires when drift is small but rate is still offset from baseRate', () => {
      // After a recovered drift burst we may have left playbackRate slightly
      // above 1. Once drift is back inside the soft threshold we return it
      // to baseRate so playback stops creeping.
      const action = decideCameraSyncAction({
        ...baseInput,
        drift: 0,
        currentPlaybackRate: 1.04
      });
      expect(action.kind).toBe('rateReset');
      expect(action.targetPlaybackRate).toBe(1);
    });

    test('ignores non-finite drift to avoid corrupting camera state', () => {
      const action = decideCameraSyncAction({ ...baseInput, drift: NaN });
      expect(action.kind).toBe('none');
    });
  });
});
