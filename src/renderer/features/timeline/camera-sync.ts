const MIN_CAMERA_SYNC_OFFSET_MS = -2000;
const MAX_CAMERA_SYNC_OFFSET_MS = 2000;

export interface PlaybackSeekPlan {
  targetSourceTime: number;
  targetCameraTime: number;
  screenNeedsSeek: boolean;
  cameraNeedsSeek: boolean;
  needsSeek: boolean;
}

export function normalizeCameraSyncOffsetMs(value: unknown): number {
  const offset = Math.round(Number(value));
  if (!Number.isFinite(offset)) return 0;
  return Math.max(MIN_CAMERA_SYNC_OFFSET_MS, Math.min(MAX_CAMERA_SYNC_OFFSET_MS, offset));
}

export function resolveCameraPlaybackTargetTime(
  screenTime: unknown,
  cameraSyncOffsetMs = 0,
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
  seekThreshold = 0.01,
): PlaybackSeekPlan {
  const safeTargetSourceTime = Number(targetSourceTime);
  const targetCameraTime = resolveCameraPlaybackTargetTime(
    safeTargetSourceTime,
    cameraSyncOffsetMs,
  );
  const screenTime = Number(currentScreenTime);
  const cameraTime = Number(currentCameraTime);
  const safeSeekThreshold = Number.isFinite(Number(seekThreshold))
    ? Math.max(0, Number(seekThreshold))
    : 0.01;

  const screenNeedsSeek =
    !Number.isFinite(screenTime) ||
    Math.abs(screenTime - safeTargetSourceTime) > safeSeekThreshold;
  const cameraNeedsSeek =
    !Number.isFinite(cameraTime) ||
    Math.abs(cameraTime - targetCameraTime) > safeSeekThreshold;

  return {
    targetSourceTime: safeTargetSourceTime,
    targetCameraTime,
    screenNeedsSeek,
    cameraNeedsSeek,
    needsSeek: screenNeedsSeek || cameraNeedsSeek,
  };
}

export function computeCameraPlaybackDrift(
  screenTime: unknown,
  cameraTime: unknown,
  cameraSyncOffsetMs = 0,
): number {
  const targetTime = resolveCameraPlaybackTargetTime(screenTime, cameraSyncOffsetMs);
  const actualTime = Number(cameraTime);
  if (!Number.isFinite(actualTime)) return targetTime;
  return targetTime - actualTime;
}
