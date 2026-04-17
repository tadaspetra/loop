import { describe, expect, test } from 'vitest';

import { vi } from 'vitest';

import {
  createAudioOnlyRecordingStream,
  createCameraRecordingStream,
  createScreenRecordingStream,
  finalizeStreamedRecording,
  getRecorderOptions,
  getRecorderFinalizeTimeoutMs,
  getRecorderTimesliceMs,
  getSupportedRecorderMimeType,
  PREVIEW_FPS_IDLE,
  PREVIEW_FPS_RECORDING,
  RECORDER_FINALIZE_TIMEOUT_MS,
  RECORDER_MIME_CANDIDATES,
  RECORDER_TIMESLICE_MS,
  shouldRenderPreviewFrame
} from '../../src/renderer/features/recording/recorder-utils';

describe('recorder-utils', () => {
  test('prefers vp8 recorder support before heavier codecs', () => {
    const mediaRecorderCtor = {
      isTypeSupported: (mimeType: string) =>
        mimeType === 'video/webm; codecs=vp8' || mimeType === 'video/webm; codecs=vp9'
    };

    expect(RECORDER_MIME_CANDIDATES[0]).toBe('video/webm; codecs=vp8');
    expect(getSupportedRecorderMimeType(mediaRecorderCtor)).toBe('video/webm; codecs=vp8');
  });

  test('falls back to empty mime type when MediaRecorder support is unavailable', () => {
    expect(getSupportedRecorderMimeType(undefined)).toBe('');
  });

  test('omits audio bitrate for camera recordings without audio tracks', () => {
    expect(getRecorderOptions({ suffix: 'camera', hasAudio: false }, undefined)).toEqual({
      videoBitsPerSecond: 10000000
    });
  });

  test('keeps screen audio bitrate when screen recording includes audio', () => {
    expect(getRecorderOptions({ suffix: 'screen', hasAudio: true }, undefined)).toEqual({
      videoBitsPerSecond: 30000000,
      audioBitsPerSecond: 192000
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
});
