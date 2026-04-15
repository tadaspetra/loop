export const RECORDER_MIME_CANDIDATES = [
  'video/webm; codecs=vp8',
  'video/webm',
  'video/webm; codecs=vp9'
] as const;

export const RECORDER_TIMESLICE_MS = 1000;
export const RECORDER_FINALIZE_TIMEOUT_MS = 15000;
export const PREVIEW_FPS_IDLE = 30;
export const PREVIEW_FPS_RECORDING = 12;

type MediaRecorderCtorLike = {
  isTypeSupported?: (mimeType: string) => boolean;
};

type MediaStreamCtorLike = new (tracks?: MediaStreamTrack[]) => MediaStream;
type BlobCtorLike = new (blobParts?: BlobPart[], options?: BlobPropertyBag) => Blob;

export interface FinalizedRecordingResult {
  blob: Blob;
  error: string | null;
  path: string | null;
  suffix: string;
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
  MediaStreamCtor: MediaStreamCtorLike = globalThis.MediaStream
): MediaStream | null {
  if (!cameraStream || typeof cameraStream.getVideoTracks !== 'function') {
    return null;
  }

  const videoTracks = cameraStream.getVideoTracks();
  if (!videoTracks.length) return null;
  return new MediaStreamCtor(videoTracks);
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

  const audioTracks =
    audioStream && typeof audioStream.getAudioTracks === 'function' ? audioStream.getAudioTracks() : [];

  return new MediaStreamCtor([...videoTracks, ...audioTracks]);
}

export async function finalizeRecordingChunks({
  chunks,
  saveFolder,
  saveVideo,
  suffix,
  BlobCtor = globalThis.Blob,
  mimeType = 'video/webm'
}: {
  chunks: BlobPart[];
  saveFolder: string;
  saveVideo: (
    buffer: ArrayBuffer,
    saveFolder: string,
    suffix: string
  ) => Promise<string | null | undefined>;
  suffix: string;
  BlobCtor?: BlobCtorLike;
  mimeType?: string;
}): Promise<FinalizedRecordingResult> {
  const blob = new BlobCtor(chunks, { type: mimeType });
  if (blob.size <= 0) {
    return {
      blob,
      error: `${suffix} recording produced no data`,
      path: null,
      suffix
    };
  }

  try {
    const buffer = await blob.arrayBuffer();
    const savedPath = await saveVideo(buffer, saveFolder, suffix);
    if (typeof savedPath !== 'string' || !savedPath.trim()) {
      throw new Error(`${suffix} recording could not be saved`);
    }

    return {
      blob,
      error: null,
      path: savedPath,
      suffix
    };
  } catch (error) {
    return {
      blob,
      error: error instanceof Error ? error.message : String(error),
      path: null,
      suffix
    };
  }
}
