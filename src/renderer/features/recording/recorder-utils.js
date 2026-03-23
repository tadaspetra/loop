export const RECORDER_MIME_CANDIDATES = [
  'video/webm; codecs=vp8',
  'video/webm',
  'video/webm; codecs=vp9'
];
export const AUDIO_RECORDER_MIME_CANDIDATES = [
  'audio/webm; codecs=opus',
  'audio/webm'
];

export const RECORDER_TIMESLICE_MS = 1000;
export const PREVIEW_FPS_IDLE = 30;
export const PREVIEW_FPS_RECORDING = 12;
export const AUDIBLE_AUDIO_THRESHOLD = 0.01;
export const AUDIO_ACTIVITY_WINDOW_MS = 50;
export const AUDIO_ACTIVITY_MIN_SEGMENT_MS = 120;

export function getSupportedRecorderMimeType(
  optionsOrMediaRecorderCtor = {},
  mediaRecorderCtor = globalThis.MediaRecorder
) {
  let options = optionsOrMediaRecorderCtor;
  if (
    arguments.length === 1
    && (
      optionsOrMediaRecorderCtor == null
      || typeof optionsOrMediaRecorderCtor.isTypeSupported === 'function'
    )
  ) {
    mediaRecorderCtor = optionsOrMediaRecorderCtor;
    options = {};
  }

  const { hasVideo = true, hasAudio = true } = options || {};
  if (!mediaRecorderCtor || typeof mediaRecorderCtor.isTypeSupported !== 'function') return '';
  const mimeCandidates = hasVideo || !hasAudio
    ? RECORDER_MIME_CANDIDATES
    : AUDIO_RECORDER_MIME_CANDIDATES;
  return mimeCandidates.find((mimeType) => mediaRecorderCtor.isTypeSupported(mimeType)) || '';
}

export function getRecorderOptions(
  { suffix, hasAudio = true, hasVideo = true } = {},
  mediaRecorderCtor = globalThis.MediaRecorder
) {
  const mimeType = getSupportedRecorderMimeType({ hasVideo, hasAudio }, mediaRecorderCtor);
  const options = mimeType ? { mimeType } : {};

  if (suffix === 'camera') {
    options.videoBitsPerSecond = 10000000;
    if (hasAudio) options.audioBitsPerSecond = 192000;
  } else if (suffix === 'screen') {
    options.videoBitsPerSecond = 30000000;
    if (hasAudio) options.audioBitsPerSecond = 192000;
  } else if (suffix === 'mic') {
    if (hasAudio) options.audioBitsPerSecond = 192000;
  }

  return options;
}

export function getRecorderTimesliceMs() {
  return RECORDER_TIMESLICE_MS;
}

export function shouldRenderPreviewFrame(now, lastFrameAt, isRecording) {
  const targetFps = isRecording ? PREVIEW_FPS_RECORDING : PREVIEW_FPS_IDLE;
  const minFrameIntervalMs = 1000 / targetFps;
  return !lastFrameAt || now - lastFrameAt >= minFrameIntervalMs;
}

export function createCameraRecordingStream(cameraStream, MediaStreamCtor = globalThis.MediaStream) {
  if (!cameraStream || typeof cameraStream.getVideoTracks !== 'function') return null;
  const videoTracks = cameraStream.getVideoTracks();
  if (!videoTracks.length) return null;
  return new MediaStreamCtor(videoTracks);
}

function normalizeDeviceLabel(label) {
  return String(label || '')
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function resolveCaptureDeviceAudioInput(sourceId, devices = []) {
  if (typeof sourceId !== 'string' || !sourceId.startsWith('device:')) return null;
  const videoDeviceId = sourceId.slice('device:'.length);
  const videoDevice = devices.find(
    (device) => device?.kind === 'videoinput' && device.deviceId === videoDeviceId
  );
  if (!videoDevice) return null;

  const audioInputs = devices.filter((device) => device?.kind === 'audioinput');
  if (!audioInputs.length) return null;

  if (videoDevice.groupId) {
    const byGroupId = audioInputs.find((device) => device.groupId && device.groupId === videoDevice.groupId);
    if (byGroupId) return byGroupId;
  }

  const normalizedVideoLabel = normalizeDeviceLabel(videoDevice.label);
  if (!normalizedVideoLabel) return null;

  return audioInputs.find((device) => {
    const normalizedAudioLabel = normalizeDeviceLabel(device.label);
    return normalizedAudioLabel && (
      normalizedAudioLabel === normalizedVideoLabel
      || normalizedAudioLabel.includes(normalizedVideoLabel)
      || normalizedVideoLabel.includes(normalizedAudioLabel)
    );
  }) || null;
}

export function getScreenCaptureConstraints(
  sourceId,
  { includeSystemAudio = true, pairedAudioInput = null } = {}
) {
  if (typeof sourceId !== 'string' || !sourceId) return null;

  if (sourceId.startsWith('device:')) {
    const deviceId = sourceId.slice('device:'.length);
    const pairedAudioDeviceId = typeof pairedAudioInput?.deviceId === 'string' && pairedAudioInput.deviceId
      ? pairedAudioInput.deviceId
      : null;
    return {
      audio: pairedAudioDeviceId ? { deviceId: { exact: pairedAudioDeviceId } } : false,
      video: {
        deviceId: { exact: deviceId },
        width: { ideal: 1920 },
        height: { ideal: 1080 }
      }
    };
  }

  return {
    audio: includeSystemAudio
      ? {
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: sourceId
        }
      }
      : false,
    video: {
      mandatory: {
        chromeMediaSource: 'desktop',
        chromeMediaSourceId: sourceId,
        maxFrameRate: 30
      }
    }
  };
}

function getAudioTracks(stream) {
  if (!stream || typeof stream.getAudioTracks !== 'function') return [];
  return stream.getAudioTracks().filter(Boolean);
}

function getVideoTracks(stream) {
  if (!stream || typeof stream.getVideoTracks !== 'function') return [];
  return stream.getVideoTracks().filter(Boolean);
}

export function createRecordingStream(
  { videoStream, systemAudioStream = null } = {},
  { MediaStreamCtor = globalThis.MediaStream } = {}
) {
  const videoTracks = getVideoTracks(videoStream);
  if (!videoTracks.length) {
    return null;
  }

  const systemAudioTracks = getAudioTracks(systemAudioStream);
  return new MediaStreamCtor([...videoTracks, ...systemAudioTracks]);
}

export function createAudioRecordingStream(audioStream, { MediaStreamCtor = globalThis.MediaStream } = {}) {
  const audioTracks = getAudioTracks(audioStream);
  if (!audioTracks.length) return null;
  return new MediaStreamCtor(audioTracks);
}

export function hasAudibleAudioSamples(
  channelDataList,
  threshold = AUDIBLE_AUDIO_THRESHOLD
) {
  if (!Array.isArray(channelDataList) || channelDataList.length === 0) return false;
  const normalizedThreshold = Math.max(0, Number(threshold) || 0);

  for (const channelData of channelDataList) {
    if (!channelData || typeof channelData.length !== 'number') continue;
    for (let i = 0; i < channelData.length; i += 1) {
      if (Math.abs(channelData[i]) >= normalizedThreshold) return true;
    }
  }

  return false;
}

export function extractAudibleAudioSegments(
  channelDataList,
  sampleRate,
  {
    threshold = AUDIBLE_AUDIO_THRESHOLD,
    windowMs = AUDIO_ACTIVITY_WINDOW_MS,
    minSegmentMs = AUDIO_ACTIVITY_MIN_SEGMENT_MS
  } = {}
) {
  if (!Array.isArray(channelDataList) || channelDataList.length === 0) return [];
  const normalizedSampleRate = Number(sampleRate);
  if (!Number.isFinite(normalizedSampleRate) || normalizedSampleRate <= 0) return [];

  const normalizedThreshold = Math.max(0, Number(threshold) || 0);
  const windowSize = Math.max(1, Math.round((normalizedSampleRate * Math.max(10, windowMs)) / 1000));
  const minSegmentSamples = Math.max(1, Math.round((normalizedSampleRate * Math.max(10, minSegmentMs)) / 1000));
  const totalSamples = Math.max(...channelDataList.map((channelData) => channelData?.length || 0));
  if (!totalSamples) return [];

  const segments = [];
  let segmentStartSample = -1;

  for (let sampleIndex = 0; sampleIndex < totalSamples; sampleIndex += windowSize) {
    let windowPeak = 0;
    for (const channelData of channelDataList) {
      if (!channelData || typeof channelData.length !== 'number') continue;
      const endIndex = Math.min(channelData.length, sampleIndex + windowSize);
      for (let i = sampleIndex; i < endIndex; i += 1) {
        windowPeak = Math.max(windowPeak, Math.abs(channelData[i] || 0));
        if (windowPeak >= normalizedThreshold) break;
      }
      if (windowPeak >= normalizedThreshold) break;
    }

    if (windowPeak >= normalizedThreshold) {
      if (segmentStartSample < 0) segmentStartSample = sampleIndex;
      continue;
    }

    if (segmentStartSample >= 0) {
      const segmentEndSample = sampleIndex;
      if (segmentEndSample - segmentStartSample >= minSegmentSamples) {
        segments.push({
          start: Number((segmentStartSample / normalizedSampleRate).toFixed(3)),
          end: Number((segmentEndSample / normalizedSampleRate).toFixed(3))
        });
      }
      segmentStartSample = -1;
    }
  }

  if (segmentStartSample >= 0) {
    const segmentEndSample = totalSamples;
    if (segmentEndSample - segmentStartSample >= minSegmentSamples) {
      segments.push({
        start: Number((segmentStartSample / normalizedSampleRate).toFixed(3)),
        end: Number((segmentEndSample / normalizedSampleRate).toFixed(3))
      });
    }
  }

  return segments.filter((segment) => segment.end > segment.start);
}

export function mergeSectioningSegments(
  speechSegments = [],
  audioSegments = []
) {
  return [...(Array.isArray(speechSegments) ? speechSegments : []), ...(Array.isArray(audioSegments) ? audioSegments : [])]
    .map((segment) => {
      const start = Number(segment?.start);
      const end = Number(segment?.end);
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
      return {
        start,
        end,
        text: typeof segment?.text === 'string' ? segment.text : ''
      };
    })
    .filter(Boolean);
}

export function shouldSkipSpeechSectioning({
  screenHasAudio = false,
  screenHasAudibleAudio = false
} = {}) {
  return Boolean(screenHasAudio && screenHasAudibleAudio);
}
