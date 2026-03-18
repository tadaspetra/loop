import { describe, expect, test } from 'vitest';
import {
  RECORDER_MIME_CANDIDATES,
  getSupportedRecorderMimeType,
  getRecorderOptions,
  createCameraRecordingStream
} from '../../src/renderer/features/recording/recorder-utils.js';

describe('recorder-utils', () => {
  test('prefers vp9 recorder support before vp8', () => {
    const mediaRecorderCtor = {
      isTypeSupported: (mimeType) => mimeType === 'video/webm; codecs=vp9' || mimeType === 'video/webm'
    };

    expect(RECORDER_MIME_CANDIDATES[0]).toBe('video/webm; codecs=vp9');
    expect(getSupportedRecorderMimeType(mediaRecorderCtor)).toBe('video/webm; codecs=vp9');
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

  test('creates a camera-only recording stream with video tracks only', () => {
    const videoTracks = [{ id: 'cam-video-1' }, { id: 'cam-video-2' }];
    const cameraStream = {
      getVideoTracks: () => videoTracks,
      getAudioTracks: () => [{ id: 'cam-audio' }]
    };

    class FakeMediaStream {
      constructor(tracks) {
        this.tracks = tracks;
      }
    }

    const recordingStream = createCameraRecordingStream(cameraStream, FakeMediaStream);
    expect(recordingStream).toBeInstanceOf(FakeMediaStream);
    expect(recordingStream.tracks).toEqual(videoTracks);
  });
});
