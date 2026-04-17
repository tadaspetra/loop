export const RECORDER_MIME_CANDIDATES = [
  'video/webm; codecs=vp8',
  'video/webm',
  'video/webm; codecs=vp9'
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
}

export function getSupportedRecorderMimeType(
  mediaRecorderCtor: MediaRecorderCtorLike | undefined = globalThis.MediaRecorder
): string {
  if (!mediaRecorderCtor || typeof mediaRecorderCtor.isTypeSupported !== 'function') {
    return '';
  }

  return (
    RECORDER_MIME_CANDIDATES.find((mimeType) => mediaRecorderCtor.isTypeSupported?.(mimeType)) || ''
  );
}

export function getRecorderOptions(
  { suffix, hasAudio = true }: { suffix?: string; hasAudio?: boolean } = {},
  mediaRecorderCtor: MediaRecorderCtorLike | undefined = globalThis.MediaRecorder
): MediaRecorderOptions {
  const mimeType = getSupportedRecorderMimeType(mediaRecorderCtor);
  const options: MediaRecorderOptions = mimeType ? { mimeType } : {};

  if (suffix === 'camera') {
    options.videoBitsPerSecond = 10000000;
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

export interface FinalizeStreamedRecordingDeps {
  finalize: (opts: {
    takeId: string;
    suffix: string;
  }) => Promise<{ path: string; bytesWritten: number }>;
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
    return {
      error: null,
      path: result.path,
      suffix,
      bytesWritten: result.bytesWritten ?? bytesWritten
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
