export const RECORDER_MIME_CANDIDATES = [
  'video/webm; codecs=vp8',
  'video/webm',
  'video/webm; codecs=vp9',
] as const;

export const RECORDER_TIMESLICE_MS = 1000;
export const PREVIEW_FPS_IDLE = 30;
export const PREVIEW_FPS_RECORDING = 12;

type MediaRecorderCtorLike = {
  isTypeSupported?: (mimeType: string) => boolean;
};

type MediaStreamCtorLike = new (tracks?: MediaStreamTrack[]) => MediaStream;

export function getSupportedRecorderMimeType(
  mediaRecorderCtor: MediaRecorderCtorLike | undefined = globalThis.MediaRecorder,
): string {
  if (
    !mediaRecorderCtor ||
    typeof mediaRecorderCtor.isTypeSupported !== 'function'
  ) {
    return '';
  }

  return (
    RECORDER_MIME_CANDIDATES.find((mimeType) =>
      mediaRecorderCtor.isTypeSupported?.(mimeType),
    ) || ''
  );
}

export function getRecorderOptions(
  { suffix, hasAudio = true }: { suffix?: string; hasAudio?: boolean } = {},
  mediaRecorderCtor: MediaRecorderCtorLike | undefined = globalThis.MediaRecorder,
): MediaRecorderOptions {
  const mimeType = getSupportedRecorderMimeType(mediaRecorderCtor);
  const options: MediaRecorderOptions = mimeType ? { mimeType } : {};

  if (suffix === 'camera') {
    options.videoBitsPerSecond = 10000000;
    if (hasAudio) options.audioBitsPerSecond = 192000;
  } else if (suffix === 'screen') {
    options.videoBitsPerSecond = 30000000;
    if (hasAudio) options.audioBitsPerSecond = 192000;
  }

  return options;
}

export function getRecorderTimesliceMs(): number {
  return RECORDER_TIMESLICE_MS;
}

export function shouldRenderPreviewFrame(
  now: number,
  lastFrameAt: number,
  isRecording: boolean,
): boolean {
  const targetFps = isRecording ? PREVIEW_FPS_RECORDING : PREVIEW_FPS_IDLE;
  const minFrameIntervalMs = 1000 / targetFps;
  return !lastFrameAt || now - lastFrameAt >= minFrameIntervalMs;
}

export function createCameraRecordingStream(
  cameraStream: MediaStream | null | undefined,
  MediaStreamCtor: MediaStreamCtorLike = globalThis.MediaStream,
): MediaStream | null {
  if (!cameraStream || typeof cameraStream.getVideoTracks !== 'function') {
    return null;
  }

  const videoTracks = cameraStream.getVideoTracks();
  if (!videoTracks.length) return null;
  return new MediaStreamCtor(videoTracks);
}
