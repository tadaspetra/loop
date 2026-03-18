export const RECORDER_MIME_CANDIDATES = [
  'video/webm; codecs=vp9',
  'video/webm; codecs=vp8',
  'video/webm'
];

export function getSupportedRecorderMimeType(mediaRecorderCtor = globalThis.MediaRecorder) {
  if (!mediaRecorderCtor || typeof mediaRecorderCtor.isTypeSupported !== 'function') return '';
  return RECORDER_MIME_CANDIDATES.find((mimeType) => mediaRecorderCtor.isTypeSupported(mimeType)) || '';
}

export function getRecorderOptions(
  { suffix, hasAudio = true } = {},
  mediaRecorderCtor = globalThis.MediaRecorder
) {
  const mimeType = getSupportedRecorderMimeType(mediaRecorderCtor);
  const options = mimeType ? { mimeType } : {};

  if (suffix === 'camera') {
    options.videoBitsPerSecond = 10000000;
    if (hasAudio) options.audioBitsPerSecond = 192000;
  } else if (suffix === 'screen') {
    options.videoBitsPerSecond = 30000000;
    if (hasAudio) options.audioBitsPerSecond = 192000;
  }

  return options;
}

export function createCameraRecordingStream(cameraStream, MediaStreamCtor = globalThis.MediaStream) {
  if (!cameraStream || typeof cameraStream.getVideoTracks !== 'function') return null;
  const videoTracks = cameraStream.getVideoTracks();
  if (!videoTracks.length) return null;
  return new MediaStreamCtor(videoTracks);
}
