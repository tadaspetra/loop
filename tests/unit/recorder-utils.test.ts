import { describe, expect, test } from 'vitest';

import {
  collectRecorderResults,
  createCameraRecordingStream,
  finalizeRecordingChunks,
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

  test('keeps camera audio bitrate when camera recording includes mic audio', () => {
    expect(getRecorderOptions({ suffix: 'camera', hasAudio: true }, undefined)).toEqual({
      videoBitsPerSecond: 10000000,
      audioBitsPerSecond: 192000
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
    expect(RECORDER_FINALIZE_TIMEOUT_MS).toBe(15000);
    expect(getRecorderFinalizeTimeoutMs()).toBe(15000);
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

  test('creates a camera recording stream with camera video and mic audio tracks', () => {
    const videoTracks = [{ id: 'cam-video-1' }, { id: 'cam-video-2' }];
    const audioTracks = [{ id: 'mic-audio-1' }];
    const cameraStream = {
      getVideoTracks: () => videoTracks
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
    expect(recordingStream).toBeInstanceOf(FakeMediaStream);
    expect((recordingStream as unknown as InstanceType<typeof FakeMediaStream>).tracks).toEqual(
      [...videoTracks, ...audioTracks]
    );
  });

  test('finalizeRecordingChunks saves video data and returns the saved path', async () => {
    const result = await finalizeRecordingChunks({
      chunks: [new Blob(['screen-data'])],
      saveFolder: '/tmp',
      suffix: 'screen',
      saveVideo: async () => '/tmp/screen.webm'
    });

    expect(result).toEqual(
      expect.objectContaining({
        suffix: 'screen',
        path: '/tmp/screen.webm',
        error: null
      })
    );
    expect(result.blob.size).toBeGreaterThan(0);
  });

  test('finalizeRecordingChunks reports save failures without throwing', async () => {
    const result = await finalizeRecordingChunks({
      chunks: [new Blob(['camera-data'])],
      saveFolder: '/tmp',
      suffix: 'camera',
      saveVideo: async () => ''
    });

    expect(result.path).toBeNull();
    expect(result.error).toMatch(/camera recording could not be saved/i);
  });

  test('collectRecorderResults surfaces screen results before slower recorder timeouts', async () => {
    const observed: string[] = [];
    let resolveScreenSeen!: () => void;
    const screenSeen = new Promise<void>((resolve) => {
      resolveScreenSeen = resolve;
    });

    const pending = collectRecorderResults(
      [
        {
          suffix: 'screen',
          blobPromise: Promise.resolve({
            blob: new Blob(['screen-data']),
            error: null,
            path: '/tmp/screen.webm',
            suffix: 'screen'
          })
        },
        {
          suffix: 'camera',
          blobPromise: new Promise(() => {})
        }
      ],
      20,
      {
        onEachResult: async (result) => {
          observed.push(result.suffix);
          if (result.suffix === 'screen') resolveScreenSeen();
        }
      }
    );

    let settled = false;
    pending.finally(() => {
      settled = true;
    });

    await screenSeen;
    expect(observed).toContain('screen');
    expect(settled).toBe(false);

    const result = await pending;
    expect(result.results.screen?.path).toBe('/tmp/screen.webm');
    expect(result.results.camera?.error).toMatch(/did not finish saving in time/i);
    expect(result.finalizeErrors).toContain(result.results.camera?.error);
  });
});
