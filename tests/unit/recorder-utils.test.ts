import { describe, expect, test } from 'vitest';

import { vi } from 'vitest';

import {
  buildMicrophoneConstraints,
  classifyRecorderFailure,
  computeCameraVideoBitsPerSecond,
  createAudioOnlyRecordingStream,
  createCameraRecordingStream,
  createScreenRecordingStream,
  finalizeStreamedRecording,
  getRecorderOptions,
  getRecorderFinalizeTimeoutMs,
  getRecorderTimesliceMs,
  getSupportedRecorderMimeType,
  isOverconstrainedError,
  PREVIEW_FPS_IDLE,
  PREVIEW_FPS_RECORDING,
  RECORDER_FINALIZE_TIMEOUT_MS,
  RECORDER_MIME_CANDIDATES,
  RECORDER_TIMESLICE_MS,
  shouldRenderPreviewFrame
} from '../../src/renderer/features/recording/recorder-utils';

describe('recorder-utils', () => {
  test('prefers vp9 over vp8, with plain webm as the last candidate', () => {
    expect(RECORDER_MIME_CANDIDATES).toEqual([
      'video/webm; codecs=vp9',
      'video/webm; codecs=vp8',
      'video/webm'
    ]);

    const bothSupported = {
      isTypeSupported: (mimeType: string) =>
        mimeType === 'video/webm; codecs=vp8' || mimeType === 'video/webm; codecs=vp9'
    };
    expect(getSupportedRecorderMimeType(bothSupported)).toBe('video/webm; codecs=vp9');
  });

  test('falls back to vp8 when vp9 is unsupported, then plain webm', () => {
    const vp8Only = {
      isTypeSupported: (mimeType: string) => mimeType === 'video/webm; codecs=vp8'
    };
    expect(getSupportedRecorderMimeType(vp8Only)).toBe('video/webm; codecs=vp8');

    const plainOnly = {
      isTypeSupported: (mimeType: string) => mimeType === 'video/webm'
    };
    expect(getSupportedRecorderMimeType(plainOnly)).toBe('video/webm');
  });

  test('falls back to empty mime type when MediaRecorder support is unavailable', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      expect(getSupportedRecorderMimeType(undefined)).toBe('');
      expect(warnSpy).toHaveBeenCalledWith(expect.stringMatching(/browser default codec/i));
    } finally {
      warnSpy.mockRestore();
    }
  });

  test('warns that the browser default codec is used when no candidate is supported', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const nothingSupported = { isTypeSupported: () => false };
      expect(getSupportedRecorderMimeType(nothingSupported)).toBe('');
      expect(warnSpy).toHaveBeenCalledWith(expect.stringMatching(/browser default codec/i));
    } finally {
      warnSpy.mockRestore();
    }
  });

  test('does not warn when a preferred codec is supported', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const supported = { isTypeSupported: () => true };
      expect(getSupportedRecorderMimeType(supported)).toBe('video/webm; codecs=vp9');
      expect(warnSpy).not.toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });

  describe('computeCameraVideoBitsPerSecond', () => {
    test('uses 30 Mbps at 4K and above', () => {
      expect(computeCameraVideoBitsPerSecond(3840, 2160)).toBe(30_000_000);
      expect(computeCameraVideoBitsPerSecond(4096, 2160)).toBe(30_000_000);
    });

    test('uses 20 Mbps at 1440p and above (below 4K)', () => {
      expect(computeCameraVideoBitsPerSecond(2560, 1440)).toBe(20_000_000);
      // Wide-but-short frames drop to the tier both dimensions satisfy.
      expect(computeCameraVideoBitsPerSecond(3840, 2158)).toBe(20_000_000);
    });

    test('uses the 12 Mbps default at 1080p and below', () => {
      expect(computeCameraVideoBitsPerSecond(1920, 1080)).toBe(12_000_000);
      expect(computeCameraVideoBitsPerSecond(2559, 1440)).toBe(12_000_000);
      expect(computeCameraVideoBitsPerSecond(1280, 720)).toBe(12_000_000);
    });

    test('treats missing or invalid dimensions as the 12 Mbps default', () => {
      expect(computeCameraVideoBitsPerSecond(undefined, undefined)).toBe(12_000_000);
      expect(computeCameraVideoBitsPerSecond(Number.NaN, 2160)).toBe(12_000_000);
      expect(computeCameraVideoBitsPerSecond(3840, Number.NaN)).toBe(12_000_000);
      expect(
        computeCameraVideoBitsPerSecond(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY)
      ).toBe(12_000_000);
      expect(computeCameraVideoBitsPerSecond(-3840, -2160)).toBe(12_000_000);
      expect(computeCameraVideoBitsPerSecond(0, 0)).toBe(12_000_000);
      expect(
        computeCameraVideoBitsPerSecond('3840' as unknown as number, '2160' as unknown as number)
      ).toBe(12_000_000);
    });
  });

  test('camera recorder options scale video bitrate with the captured resolution', () => {
    expect(
      getRecorderOptions(
        { suffix: 'camera', hasAudio: false, videoWidth: 3840, videoHeight: 2160 },
        undefined
      )
    ).toEqual({ videoBitsPerSecond: 30_000_000 });
    expect(
      getRecorderOptions(
        { suffix: 'camera', hasAudio: false, videoWidth: 2560, videoHeight: 1440 },
        undefined
      )
    ).toEqual({ videoBitsPerSecond: 20_000_000 });
  });

  test('omits audio bitrate for camera recordings without audio tracks', () => {
    expect(getRecorderOptions({ suffix: 'camera', hasAudio: false }, undefined)).toEqual({
      videoBitsPerSecond: 12_000_000
    });
  });

  test('keeps screen audio bitrate when screen recording includes audio', () => {
    expect(getRecorderOptions({ suffix: 'screen', hasAudio: true }, undefined)).toEqual({
      videoBitsPerSecond: 30000000,
      audioBitsPerSecond: 192000
    });
  });

  test('screen bitrate stays fixed at 30 Mbps regardless of captured dimensions', () => {
    expect(
      getRecorderOptions(
        { suffix: 'screen', hasAudio: false, videoWidth: 5120, videoHeight: 2880 },
        undefined
      )
    ).toEqual({ videoBitsPerSecond: 30000000 });
  });

  describe('microphone constraints', () => {
    test('requests explicit quality constraints with ideal (not exact) sample rate and channels', () => {
      expect(buildMicrophoneConstraints('mic-1')).toEqual({
        deviceId: { exact: 'mic-1' },
        sampleRate: { ideal: 48000 },
        channelCount: { ideal: 2 },
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false
      });
    });

    test('falls back to device-id-only constraints so capture beats quality', () => {
      expect(buildMicrophoneConstraints('mic-1', { includeQualityConstraints: false })).toEqual({
        deviceId: { exact: 'mic-1' }
      });
    });

    test('detects OverconstrainedError rejections and nothing else', () => {
      expect(isOverconstrainedError({ name: 'OverconstrainedError' })).toBe(true);
      const domLike = new Error('constraints not satisfied');
      domLike.name = 'OverconstrainedError';
      expect(isOverconstrainedError(domLike)).toBe(true);

      expect(isOverconstrainedError(new Error('NotAllowedError'))).toBe(false);
      expect(isOverconstrainedError({ name: 'NotReadableError' })).toBe(false);
      expect(isOverconstrainedError(null)).toBe(false);
      expect(isOverconstrainedError(undefined)).toBe(false);
      expect(isOverconstrainedError('OverconstrainedError')).toBe(false);
    });
  });

  test('flushes recorder data on a steady interval during capture', () => {
    expect(RECORDER_TIMESLICE_MS).toBe(1000);
    expect(getRecorderTimesliceMs()).toBe(1000);
  });

  test('uses a bounded wait when recorder finalization stalls', () => {
    // 60s is generous enough for a rename-on-finalize on flaky disks while
    // still bounding the UI wait if MediaRecorder.onstop never fires.
    expect(RECORDER_FINALIZE_TIMEOUT_MS).toBe(60_000);
    expect(getRecorderFinalizeTimeoutMs()).toBe(60_000);
  });

  test('throttles preview updates more aggressively while recording', () => {
    expect(PREVIEW_FPS_IDLE).toBe(30);
    expect(PREVIEW_FPS_RECORDING).toBe(12);
    expect(shouldRenderPreviewFrame(0, 0, true)).toBe(true);
    expect(shouldRenderPreviewFrame(40, 0, false)).toBe(true);
    expect(shouldRenderPreviewFrame(40, 20, false)).toBe(false);
    expect(shouldRenderPreviewFrame(110, 20, true)).toBe(true);
    expect(shouldRenderPreviewFrame(90, 20, true)).toBe(false);
  });

  test('creates a camera-only recording stream with video tracks only when no mic is provided', () => {
    const videoTracks = [{ id: 'cam-video-1' }, { id: 'cam-video-2' }];
    const cameraStream = {
      getVideoTracks: () => videoTracks,
      getAudioTracks: () => [{ id: 'cam-audio' }]
    };

    class FakeMediaStream {
      tracks: unknown[];
      constructor(tracks: unknown[]) {
        this.tracks = tracks;
      }
    }

    const recordingStream = createCameraRecordingStream(
      cameraStream as unknown as MediaStream,
      null,
      FakeMediaStream as unknown as typeof MediaStream
    );
    expect(recordingStream).toBeInstanceOf(FakeMediaStream);
    expect((recordingStream as unknown as InstanceType<typeof FakeMediaStream>).tracks).toEqual(
      videoTracks
    );
  });

  test('merges microphone audio tracks into the camera recording stream when provided', () => {
    const videoTracks = [{ id: 'cam-video-1' }];
    const audioTracks = [{ id: 'mic-audio-1' }, { id: 'mic-audio-2' }];
    const cameraStream = {
      // The camera stream's own (video-pipeline) audio tracks must be ignored
      // so we never accidentally double-count or record device audio the user
      // did not pick.
      getVideoTracks: () => videoTracks,
      getAudioTracks: () => [{ id: 'cam-builtin-audio-ignored' }]
    };
    const audioStream = {
      getAudioTracks: () => audioTracks
    };

    class FakeMediaStream {
      tracks: unknown[];
      constructor(tracks: unknown[]) {
        this.tracks = tracks;
      }
    }

    const recordingStream = createCameraRecordingStream(
      cameraStream as unknown as MediaStream,
      audioStream as unknown as MediaStream,
      FakeMediaStream as unknown as typeof MediaStream
    );

    expect((recordingStream as unknown as InstanceType<typeof FakeMediaStream>).tracks).toEqual([
      ...videoTracks,
      ...audioTracks
    ]);
  });

  test('creates an audio-only recording stream from microphone audio tracks', () => {
    const audioTracks = [{ id: 'mic-audio-1' }];
    const audioStream = {
      getAudioTracks: () => audioTracks
    };

    class FakeMediaStream {
      tracks: unknown[];
      constructor(tracks: unknown[]) {
        this.tracks = tracks;
      }
    }

    const recordingStream = createAudioOnlyRecordingStream(
      audioStream as unknown as MediaStream,
      FakeMediaStream as unknown as typeof MediaStream
    );

    expect(recordingStream).toBeInstanceOf(FakeMediaStream);
    expect((recordingStream as unknown as InstanceType<typeof FakeMediaStream>).tracks).toEqual(
      audioTracks
    );
  });

  test('returns null for an audio-only recording stream when there are no audio tracks', () => {
    const audioStream = { getAudioTracks: () => [] };
    expect(createAudioOnlyRecordingStream(audioStream as unknown as MediaStream)).toBeNull();
    expect(createAudioOnlyRecordingStream(null)).toBeNull();
  });

  test('audio-only recorder options keep mic bitrate without a video bitrate', () => {
    expect(getRecorderOptions({ suffix: 'audio', hasAudio: true }, undefined)).toEqual({
      audioBitsPerSecond: 192000
    });
    expect(getRecorderOptions({ suffix: 'audio', hasAudio: false }, undefined)).toEqual({});
  });

  test('keeps screen-stream audio tracks (for system audio loopback) in the screen recording stream', () => {
    // getDisplayMedia with audio loopback attaches system audio to the screen
    // stream itself, so createScreenRecordingStream must retain those tracks.
    const screenVideoTracks = [{ id: 'screen-video-1' }];
    const screenAudioTracks = [{ id: 'system-audio-1' }];
    const screenStream = {
      getVideoTracks: () => screenVideoTracks,
      getAudioTracks: () => screenAudioTracks
    };

    class FakeMediaStream {
      tracks: unknown[];
      constructor(tracks: unknown[]) {
        this.tracks = tracks;
      }
    }

    const recordingStream = createScreenRecordingStream(
      screenStream as unknown as MediaStream,
      null,
      FakeMediaStream as unknown as typeof MediaStream
    );

    expect((recordingStream as unknown as InstanceType<typeof FakeMediaStream>).tracks).toEqual([
      ...screenVideoTracks,
      ...screenAudioTracks
    ]);
  });

  test('creates a screen-only recording stream when microphone audio is unavailable', () => {
    const screenVideoTracks = [{ id: 'screen-video-1' }];
    const screenStream = {
      getVideoTracks: () => screenVideoTracks,
      getAudioTracks: () => []
    };

    class FakeMediaStream {
      tracks: unknown[];
      constructor(tracks: unknown[]) {
        this.tracks = tracks;
      }
    }

    const recordingStream = createScreenRecordingStream(
      screenStream as unknown as MediaStream,
      null,
      FakeMediaStream as unknown as typeof MediaStream
    );

    expect((recordingStream as unknown as InstanceType<typeof FakeMediaStream>).tracks).toEqual(
      screenVideoTracks
    );
  });

  test('finalizeStreamedRecording renames the streamed temp file and returns the final path', async () => {
    const finalize = vi.fn(async () => ({ path: '/tmp/screen.webm', bytesWritten: 2048 }));

    const result = await finalizeStreamedRecording({
      takeId: 'take-1',
      suffix: 'screen',
      bytesWritten: 2048,
      deps: { finalize }
    });

    expect(finalize).toHaveBeenCalledWith({ takeId: 'take-1', suffix: 'screen' });
    expect(result).toEqual({
      suffix: 'screen',
      path: '/tmp/screen.webm',
      error: null,
      bytesWritten: 2048
    });
  });

  test('finalizeStreamedRecording carries a durability warning through and logs it prominently', async () => {
    const finalize = vi.fn(async () => ({
      path: '/tmp/screen.webm',
      bytesWritten: 2048,
      warning: 'fsync failed at finalize; bytes may not be fully flushed: EIO'
    }));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      const result = await finalizeStreamedRecording({
        takeId: 'take-warn',
        suffix: 'screen',
        bytesWritten: 2048,
        deps: { finalize }
      });

      // The recording still succeeded — a durability warning is not an error.
      expect(result.error).toBeNull();
      expect(result.path).toBe('/tmp/screen.webm');
      expect(result.warning).toMatch(/fsync/i);
      expect(errorSpy).toHaveBeenCalledWith(expect.stringMatching(/durability warning/i));
    } finally {
      errorSpy.mockRestore();
    }
  });

  test('finalizeStreamedRecording reports an error and cancels when no bytes were written', async () => {
    const finalize = vi.fn();
    const cancel = vi.fn(async () => ({ cancelled: true }));

    const result = await finalizeStreamedRecording({
      takeId: 'take-empty',
      suffix: 'camera',
      bytesWritten: 0,
      deps: { finalize, cancel }
    });

    expect(finalize).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledWith({ takeId: 'take-empty', suffix: 'camera' });
    expect(result.path).toBeNull();
    expect(result.bytesWritten).toBe(0);
    expect(result.error).toMatch(/produced no data/i);
  });

  test('finalizeStreamedRecording surfaces main-process finalize failures', async () => {
    const finalize = vi.fn(async () => {
      throw new Error('rename failed');
    });

    const result = await finalizeStreamedRecording({
      takeId: 'take-err',
      suffix: 'screen',
      bytesWritten: 128,
      deps: { finalize }
    });

    expect(result.path).toBeNull();
    expect(result.error).toBe('rename failed');
    expect(result.bytesWritten).toBe(128);
  });

  test('finalizeStreamedRecording treats an empty finalize path as failure', async () => {
    const finalize = vi.fn(async () => ({ path: '', bytesWritten: 42 }));

    const result = await finalizeStreamedRecording({
      takeId: 'take-bad',
      suffix: 'screen',
      bytesWritten: 42,
      deps: { finalize }
    });

    expect(result.path).toBeNull();
    expect(result.error).toMatch(/could not be saved/i);
  });

  describe('classifyRecorderFailure', () => {
    test('auto-stops when the screen recorder can no longer append chunks to disk', () => {
      const decision = classifyRecorderFailure('append', 'screen');
      expect(decision.shouldAutoStop).toBe(true);
      expect(decision.userMessage).toMatch(/screen/i);
      expect(decision.userMessage).toMatch(/save/i);
      expect(decision.userMessage).toMatch(/stopping/i);
    });

    test('auto-stops on a screen recorder (encoder) error to finalize what is on disk', () => {
      const decision = classifyRecorderFailure('recorder-error', 'screen');
      expect(decision.shouldAutoStop).toBe(true);
      expect(decision.userMessage).toMatch(/screen/i);
      expect(decision.userMessage).toMatch(/stopping/i);
    });

    test('auto-stops when the dedicated mic recorder fails (append or encoder error)', () => {
      const appendDecision = classifyRecorderFailure('append', 'audio');
      expect(appendDecision.shouldAutoStop).toBe(true);
      expect(appendDecision.userMessage).toMatch(/microphone/i);
      expect(appendDecision.userMessage).toMatch(/stopping/i);

      const errorDecision = classifyRecorderFailure('recorder-error', 'audio');
      expect(errorDecision.shouldAutoStop).toBe(true);
      expect(errorDecision.userMessage).toMatch(/microphone/i);
      expect(errorDecision.userMessage).toMatch(/stopping/i);
    });

    test('camera append failure warns but keeps the recording going for partial success', () => {
      const decision = classifyRecorderFailure('append', 'camera');
      expect(decision.shouldAutoStop).toBe(false);
      expect(decision.userMessage).toMatch(/camera/i);
      expect(decision.userMessage).toMatch(/continuing/i);
      expect(decision.userMessage).toMatch(/screen/i);
    });

    test('camera recorder error warns but keeps the recording going for partial success', () => {
      const decision = classifyRecorderFailure('recorder-error', 'camera');
      expect(decision.shouldAutoStop).toBe(false);
      expect(decision.userMessage).toMatch(/camera/i);
      expect(decision.userMessage).toMatch(/continuing/i);
    });

    test('system-audio fallback never stops the recording and only informs', () => {
      const decision = classifyRecorderFailure('system-audio', 'screen');
      expect(decision.shouldAutoStop).toBe(false);
      expect(decision.userMessage).toBe('System audio unavailable — recording screen without it');
    });
  });
});
