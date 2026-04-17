import { normalizeCameraSyncOffsetMs } from '../../../shared/domain/camera-sync';

// Re-export the shared normalization so the renderer keeps a single import
// site while domain rules stay in src/shared/.
export { normalizeCameraSyncOffsetMs };

export interface PlaybackSeekPlan {
  targetSourceTime: number;
  targetCameraTime: number;
  screenNeedsSeek: boolean;
  cameraNeedsSeek: boolean;
  needsSeek: boolean;
}

export function resolveCameraPlaybackTargetTime(
  screenTime: unknown,
  cameraSyncOffsetMs = 0
): number {
  const baseTime = Number(screenTime);
  if (!Number.isFinite(baseTime)) return 0;
  return Math.max(0, baseTime + normalizeCameraSyncOffsetMs(cameraSyncOffsetMs) / 1000);
}

export function computePlaybackSeekPlan(
  currentScreenTime: unknown,
  currentCameraTime: unknown,
  targetSourceTime: unknown,
  cameraSyncOffsetMs = 0,
  seekThreshold = 0.01
): PlaybackSeekPlan {
  const safeTargetSourceTime = Number(targetSourceTime);
  const targetCameraTime = resolveCameraPlaybackTargetTime(
    safeTargetSourceTime,
    cameraSyncOffsetMs
  );
  const screenTime = Number(currentScreenTime);
  const cameraTime = Number(currentCameraTime);
  const safeSeekThreshold = Number.isFinite(Number(seekThreshold))
    ? Math.max(0, Number(seekThreshold))
    : 0.01;

  const screenNeedsSeek =
    !Number.isFinite(screenTime) || Math.abs(screenTime - safeTargetSourceTime) > safeSeekThreshold;
  const cameraNeedsSeek =
    !Number.isFinite(cameraTime) || Math.abs(cameraTime - targetCameraTime) > safeSeekThreshold;

  return {
    targetSourceTime: safeTargetSourceTime,
    targetCameraTime,
    screenNeedsSeek,
    cameraNeedsSeek,
    needsSeek: screenNeedsSeek || cameraNeedsSeek
  };
}

export function computeCameraPlaybackDrift(
  screenTime: unknown,
  cameraTime: unknown,
  cameraSyncOffsetMs = 0
): number {
  const targetTime = resolveCameraPlaybackTargetTime(screenTime, cameraSyncOffsetMs);
  const actualTime = Number(cameraTime);
  if (!Number.isFinite(actualTime)) return targetTime;
  return targetTime - actualTime;
}

export type CameraSyncActionKind = 'none' | 'hardResync' | 'softRate' | 'rateReset';

export interface CameraSyncAction {
  kind: CameraSyncActionKind;
  // Target camera.currentTime to set when kind === 'hardResync'.
  targetCameraTime?: number;
  // Target camera.playbackRate when kind === 'softRate' or 'rateReset'.
  targetPlaybackRate?: number;
  // Proposed next cooldown-until timestamp when kind === 'hardResync'.
  nextResyncCooldownUntil?: number;
}

export interface CameraSyncThresholds {
  // Minimum absolute drift (seconds) before any soft rate correction kicks
  // in. Below this we prefer doing nothing so pitch doesn't wobble over
  // harmless micro-drift.
  softThreshold: number;
  // Minimum absolute drift (seconds) before a hard resync (camera seek) is
  // even considered. Set well above typical seek latency so we don't chase
  // our own tail after a boundary cross.
  hardThreshold: number;
  // Maximum absolute deviation of camera.playbackRate from baseRate allowed
  // during soft correction, so audio pitch never wanders noticeably.
  maxRateCorrection: number;
  // Rate changes below this delta are ignored to avoid jittering the
  // playbackRate setter every frame with sub-perceptual tweaks.
  minRateChange: number;
  // Hard resyncs spaced closer than this are suppressed so a thrash loop
  // (seek → stall → drift → seek) cannot form.
  resyncCooldownMs: number;
}

export const DEFAULT_CAMERA_SYNC_THRESHOLDS: CameraSyncThresholds = {
  softThreshold: 0.05,
  hardThreshold: 0.3,
  maxRateCorrection: 0.08,
  minRateChange: 0.004,
  resyncCooldownMs: 1500
};

export interface CameraSyncDecisionInput {
  drift: number;
  baseRate: number;
  currentPlaybackRate: number;
  targetCameraTime: number;
  nowMs: number;
  resyncCooldownUntil: number;
  suppressedUntil: number;
  thresholds?: Partial<CameraSyncThresholds>;
}

/**
 * Pure decision function that mirrors the runtime camera-sync logic in
 * app.ts's `syncCameraPlayback`. Returns the action the runtime should
 * apply. Extracted here so the threshold / cooldown / suppression rules
 * can be exercised with unit tests without standing up a full DOM.
 */
export function decideCameraSyncAction({
  drift,
  baseRate,
  currentPlaybackRate,
  targetCameraTime,
  nowMs,
  resyncCooldownUntil,
  suppressedUntil,
  thresholds
}: CameraSyncDecisionInput): CameraSyncAction {
  const merged: CameraSyncThresholds = { ...DEFAULT_CAMERA_SYNC_THRESHOLDS, ...thresholds };
  if (!Number.isFinite(drift) || !Number.isFinite(baseRate)) {
    return { kind: 'none' };
  }
  // Suppression window (e.g. right after a seek / section switch): do
  // nothing so we don't chase seek latency with spurious corrections.
  if (Number.isFinite(suppressedUntil) && nowMs < suppressedUntil) {
    return { kind: 'none' };
  }
  const absDrift = Math.abs(drift);

  if (absDrift >= merged.hardThreshold && nowMs >= resyncCooldownUntil) {
    return {
      kind: 'hardResync',
      targetCameraTime,
      targetPlaybackRate: baseRate,
      nextResyncCooldownUntil: nowMs + merged.resyncCooldownMs
    };
  }

  if (absDrift >= merged.softThreshold) {
    const correction = Math.min(merged.maxRateCorrection, absDrift * 0.5);
    const desiredRate = drift > 0 ? baseRate + correction : baseRate - correction;
    const clampedRate = Math.max(
      baseRate - merged.maxRateCorrection,
      Math.min(baseRate + merged.maxRateCorrection, desiredRate)
    );
    if (Math.abs(currentPlaybackRate - clampedRate) <= merged.minRateChange) {
      return { kind: 'none' };
    }
    return { kind: 'softRate', targetPlaybackRate: clampedRate };
  }

  if (Math.abs(currentPlaybackRate - baseRate) > 0.001) {
    return { kind: 'rateReset', targetPlaybackRate: baseRate };
  }

  return { kind: 'none' };
}
