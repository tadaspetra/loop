// Ordered by preference: VP9 gives noticeably better quality-per-bit than
// VP8 at the bitrates we record at, so try it first and step down.
export const RECORDER_MIME_CANDIDATES = [
  'video/webm; codecs=vp9',
  'video/webm; codecs=vp8',
  'video/webm'
] as const;

export const RECORDER_TIMESLICE_MS = 1000;
// Recording bytes are streamed to disk as they arrive (see
// recording-service), so the finalize step is just flush+rename. We still
// bound the wait so a pathological MediaRecorder bug cannot wedge stop
// forever, but the value now reflects "real worst case for a rename on a
// flaky disk" rather than "time to upload the whole blob via IPC".
export const RECORDER_FINALIZE_TIMEOUT_MS = 60_000;
export const PREVIEW_FPS_IDLE = 30;
export const PREVIEW_FPS_RECORDING = 12;

type MediaRecorderCtorLike = {
  isTypeSupported?: (mimeType: string) => boolean;
};

type MediaStreamCtorLike = new (tracks?: MediaStreamTrack[]) => MediaStream;

export interface FinalizedRecordingResult {
  error: string | null;
  path: string | null;
  suffix: string;
  bytesWritten: number;
  /** Durability warning from the main process (e.g. fsync failed); the file
   *  was still saved, but the caller should surface the degraded guarantee. */
  warning?: string;
}

export function getSupportedRecorderMimeType(
  mediaRecorderCtor: MediaRecorderCtorLike | undefined = globalThis.MediaRecorder
): string {
  if (!mediaRecorderCtor || typeof mediaRecorderCtor.isTypeSupported !== 'function') {
    console.warn(
      '[Recorder] MediaRecorder.isTypeSupported is unavailable — recording with the browser default codec.'
    );
    return '';
  }

  const supported = RECORDER_MIME_CANDIDATES.find((mimeType) =>
    mediaRecorderCtor.isTypeSupported?.(mimeType)
  );
  if (!supported) {
    console.warn(
      '[Recorder] No preferred WebM codec (vp9/vp8/webm) is supported — recording with the browser default codec.'
    );
    return '';
  }
  return supported;
}

// Camera bitrate tiers by captured resolution. The camera opens at up to 4K
// now, so the bitrate has to scale with what the device actually delivered
// (read from track.getSettings() after getUserMedia) or 4K footage would be
// starved at a 1080p-era bitrate.
export const CAMERA_VIDEO_BITS_PER_SECOND_4K = 30_000_000;
export const CAMERA_VIDEO_BITS_PER_SECOND_1440P = 20_000_000;
export const CAMERA_VIDEO_BITS_PER_SECOND_DEFAULT = 12_000_000;

export function computeCameraVideoBitsPerSecond(width?: unknown, height?: unknown): number {
  const w = typeof width === 'number' && Number.isFinite(width) && width > 0 ? width : 0;
  const h = typeof height === 'number' && Number.isFinite(height) && height > 0 ? height : 0;

  if (w >= 3840 && h >= 2160) return CAMERA_VIDEO_BITS_PER_SECOND_4K;
  if (w >= 2560 && h >= 1440) return CAMERA_VIDEO_BITS_PER_SECOND_1440P;
  return CAMERA_VIDEO_BITS_PER_SECOND_DEFAULT;
}

export function getRecorderOptions(
  {
    suffix,
    hasAudio = true,
    videoWidth,
    videoHeight
  }: { suffix?: string; hasAudio?: boolean; videoWidth?: number; videoHeight?: number } = {},
  mediaRecorderCtor: MediaRecorderCtorLike | undefined = globalThis.MediaRecorder
): MediaRecorderOptions {
  const mimeType = getSupportedRecorderMimeType(mediaRecorderCtor);
  const options: MediaRecorderOptions = mimeType ? { mimeType } : {};

  if (suffix === 'camera') {
    options.videoBitsPerSecond = computeCameraVideoBitsPerSecond(videoWidth, videoHeight);
    if (hasAudio) options.audioBitsPerSecond = 192000;
  } else if (suffix === 'screen') {
    options.videoBitsPerSecond = 30000000;
    if (hasAudio) options.audioBitsPerSecond = 192000;
  } else if (suffix === 'audio') {
    // Audio-only recorder: no video payload, keep the mic bitrate in line with
    // the muxed-audio paths so Premiere/export comparisons stay consistent.
    if (hasAudio) options.audioBitsPerSecond = 192000;
  }

  return options;
}

/**
 * Constraints for opening the microphone. Quality knobs (sample rate,
 * channel count, disabled processing) use `ideal`/plain values rather than
 * `exact` so a constrained device can still open; only the device id itself
 * is exact. The device-id-only fallback exists because capture beats
 * quality: if a device rejects the quality constraints with
 * OverconstrainedError, retry with just the id instead of losing the mic.
 */
export function buildMicrophoneConstraints(
  deviceId: string,
  { includeQualityConstraints = true }: { includeQualityConstraints?: boolean } = {}
): MediaTrackConstraints {
  if (!includeQualityConstraints) {
    return { deviceId: { exact: deviceId } };
  }

  return {
    deviceId: { exact: deviceId },
    sampleRate: { ideal: 48000 },
    channelCount: { ideal: 2 },
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false
  };
}

export function isOverconstrainedError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { name?: unknown }).name === 'OverconstrainedError'
  );
}

export function getRecorderTimesliceMs(): number {
  return RECORDER_TIMESLICE_MS;
}

export function getRecorderFinalizeTimeoutMs(): number {
  return RECORDER_FINALIZE_TIMEOUT_MS;
}

export function shouldRenderPreviewFrame(
  now: number,
  lastFrameAt: number,
  isRecording: boolean
): boolean {
  const targetFps = isRecording ? PREVIEW_FPS_RECORDING : PREVIEW_FPS_IDLE;
  const minFrameIntervalMs = 1000 / targetFps;
  return !lastFrameAt || now - lastFrameAt >= minFrameIntervalMs;
}

export function createCameraRecordingStream(
  cameraStream: MediaStream | null | undefined,
  audioStream: MediaStream | null | undefined = null,
  MediaStreamCtor: MediaStreamCtorLike = globalThis.MediaStream
): MediaStream | null {
  if (!cameraStream || typeof cameraStream.getVideoTracks !== 'function') {
    return null;
  }

  const videoTracks = cameraStream.getVideoTracks();
  if (!videoTracks.length) return null;

  const audioTracks =
    audioStream && typeof audioStream.getAudioTracks === 'function'
      ? audioStream.getAudioTracks()
      : [];

  return new MediaStreamCtor([...videoTracks, ...audioTracks]);
}

export function createAudioOnlyRecordingStream(
  audioStream: MediaStream | null | undefined,
  MediaStreamCtor: MediaStreamCtorLike = globalThis.MediaStream
): MediaStream | null {
  if (!audioStream || typeof audioStream.getAudioTracks !== 'function') {
    return null;
  }

  const audioTracks = audioStream.getAudioTracks();
  if (!audioTracks.length) return null;
  return new MediaStreamCtor(audioTracks);
}

export function createScreenRecordingStream(
  screenStream: MediaStream | null | undefined,
  audioStream: MediaStream | null | undefined,
  MediaStreamCtor: MediaStreamCtorLike = globalThis.MediaStream
): MediaStream | null {
  if (!screenStream || typeof screenStream.getVideoTracks !== 'function') {
    return null;
  }

  const videoTracks = screenStream.getVideoTracks();
  if (!videoTracks.length) return null;

  // System audio captured via getDisplayMedia loopback arrives on the screen
  // stream itself; preserve those tracks so the screen webm carries desktop
  // audio when the user opted in. Mic (from the separate audioStream) is
  // intentionally NOT added here: it now routes to the camera file or a
  // dedicated audio-only file.
  const screenAudioTracks =
    typeof screenStream.getAudioTracks === 'function' ? screenStream.getAudioTracks() : [];
  const extraAudioTracks =
    audioStream && typeof audioStream.getAudioTracks === 'function'
      ? audioStream.getAudioTracks()
      : [];

  return new MediaStreamCtor([...videoTracks, ...screenAudioTracks, ...extraAudioTracks]);
}

export type RecorderFailureKind = 'append' | 'recorder-error' | 'system-audio';
export type RecorderFailureSuffix = 'screen' | 'camera' | 'audio';

export interface RecorderFailureDecision {
  shouldAutoStop: boolean;
  userMessage: string;
}

const RECORDER_SUFFIX_LABELS: Record<RecorderFailureSuffix, string> = {
  screen: 'Screen',
  camera: 'Camera',
  audio: 'Microphone'
};

/**
 * Decide how the recording UI should react to a mid-capture failure.
 *
 * Policy (mirrors the critical/non-critical track policy used for
 * track-ended monitoring):
 * - screen or dedicated mic recorder failing to append (disk/IPC) or hitting
 *   an encoder error means every later chunk is also lost, so auto-stop the
 *   whole recording to finalize what is already on disk.
 * - camera-only failure keeps the recording going: partial success must still
 *   save the screen file, so just warn.
 * - system-audio loopback fallback never stops anything; it only informs that
 *   the screen is being recorded without desktop audio.
 */
export function classifyRecorderFailure(
  kind: RecorderFailureKind,
  suffix: RecorderFailureSuffix
): RecorderFailureDecision {
  if (kind === 'system-audio') {
    return {
      shouldAutoStop: false,
      userMessage: 'System audio unavailable — recording screen without it'
    };
  }

  if (suffix === 'camera') {
    return {
      shouldAutoStop: false,
      userMessage:
        kind === 'append'
          ? 'Camera recording can no longer save to disk — continuing with screen only.'
          : 'Camera recorder failed — continuing with screen only.'
    };
  }

  const label = RECORDER_SUFFIX_LABELS[suffix] || suffix;
  return {
    shouldAutoStop: true,
    userMessage:
      kind === 'append'
        ? `${label} recording can no longer save to disk — stopping to keep what has been saved.`
        : `${label} recorder failed — stopping to keep what has been saved.`
  };
}

export interface FinalizeStreamedRecordingDeps {
  finalize: (opts: {
    takeId: string;
    suffix: string;
  }) => Promise<{ path: string; bytesWritten: number; warning?: string }>;
  cancel?: (opts: { takeId: string; suffix: string }) => Promise<{ cancelled: boolean }>;
}

/**
 * Finalize a recording whose chunks have already been streamed to disk via
 * the recording-service IPC. This is an atomic rename on the main side so it
 * is fast and tolerant of large recordings.
 */
export async function finalizeStreamedRecording({
  takeId,
  suffix,
  bytesWritten,
  deps
}: {
  takeId: string;
  suffix: string;
  bytesWritten: number;
  deps: FinalizeStreamedRecordingDeps;
}): Promise<FinalizedRecordingResult> {
  if (!bytesWritten || bytesWritten <= 0) {
    if (deps.cancel) {
      try {
        await deps.cancel({ takeId, suffix });
      } catch (error) {
        console.warn(`[Recorder] cancel after empty ${suffix} recording failed:`, error);
      }
    }
    return {
      error: `${suffix} recording produced no data`,
      path: null,
      suffix,
      bytesWritten: 0
    };
  }

  try {
    const result = await deps.finalize({ takeId, suffix });
    if (!result?.path) {
      throw new Error(`${suffix} recording could not be saved`);
    }
    if (result.warning) {
      // Durability warning from the main process: the bytes were saved, but
      // an fsync failed somewhere along the way. Log loudly so degraded
      // durability is never silently swallowed, and carry it on the result.
      console.error(
        `[Recorder] DURABILITY WARNING for ${suffix} recording at ${result.path}: ${result.warning}`
      );
    }
    return {
      error: null,
      path: result.path,
      suffix,
      bytesWritten: result.bytesWritten ?? bytesWritten,
      ...(result.warning ? { warning: result.warning } : {})
    };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : String(error),
      path: null,
      suffix,
      bytesWritten
    };
  }
}
