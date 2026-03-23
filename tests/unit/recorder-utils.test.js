class FakeMediaStream {
  constructor(tracks = []) {
    this.tracks = tracks;
  }

  getVideoTracks() {
    return this.tracks.filter((track) => track.kind === 'video');
  }

  getAudioTracks() {
    return this.tracks.filter((track) => track.kind === 'audio');
  }
}

class FakeAudioContext {
  constructor() {
    this.sourceNodes = [];
    this.destination = {
      stream: new FakeMediaStream([{ kind: 'audio', id: 'mixed-audio' }])
    };
    this.closed = false;
    FakeAudioContext.instances.push(this);
  }

  createMediaStreamDestination() {
    return this.destination;
  }

  createMediaStreamSource(stream) {
    const node = {
      stream,
      connectedTo: null,
      disconnected: false,
      connect: (destination) => {
        node.connectedTo = destination;
      },
      disconnect: () => {
        node.disconnected = true;
      }
    };
    this.sourceNodes.push(node);
    return node;
  }

  async close() {
    this.closed = true;
  }
}

FakeAudioContext.instances = [];
const recorderUtilsPromise = import('../../src/renderer/features/recording/recorder-utils.js');

describe('renderer/features/recording/recorder-utils', () => {
  beforeEach(() => {
    FakeAudioContext.instances.length = 0;
  });

  test('getScreenCaptureConstraints keeps capture devices video-only', async () => {
    const recorderUtils = await recorderUtilsPromise;
    const constraints = recorderUtils.getScreenCaptureConstraints('device:camera-1');

    expect(constraints).toEqual({
      audio: false,
      video: {
        deviceId: { exact: 'camera-1' },
        width: { ideal: 1920 },
        height: { ideal: 1080 }
      }
    });
  });

  test('getScreenCaptureConstraints pairs capture device audio when available', async () => {
    const recorderUtils = await recorderUtilsPromise;
    const constraints = recorderUtils.getScreenCaptureConstraints('device:camlink-video', {
      pairedAudioInput: { deviceId: 'camlink-audio' }
    });

    expect(constraints).toEqual({
      audio: { deviceId: { exact: 'camlink-audio' } },
      video: {
        deviceId: { exact: 'camlink-video' },
        width: { ideal: 1920 },
        height: { ideal: 1080 }
      }
    });
  });

  test('getScreenCaptureConstraints requests system audio for desktop sources', async () => {
    const recorderUtils = await recorderUtilsPromise;
    const constraints = recorderUtils.getScreenCaptureConstraints('screen:0:0');

    expect(constraints).toEqual({
      audio: {
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: 'screen:0:0'
        }
      },
      video: {
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: 'screen:0:0',
          maxFrameRate: 30
        }
      }
    });
  });

  test('getScreenCaptureConstraints can fall back to desktop video without system audio', async () => {
    const recorderUtils = await recorderUtilsPromise;
    const constraints = recorderUtils.getScreenCaptureConstraints('window:123:0', {
      includeSystemAudio: false
    });

    expect(constraints.audio).toBe(false);
    expect(constraints.video).toEqual({
      mandatory: {
        chromeMediaSource: 'desktop',
        chromeMediaSourceId: 'window:123:0',
        maxFrameRate: 30
      }
    });
  });

  test('createRecordingStream returns video-only stream when there are no audio inputs', async () => {
    const recorderUtils = await recorderUtilsPromise;
    const videoTrack = { kind: 'video', id: 'screen-video' };
    const videoStream = new FakeMediaStream([videoTrack]);

    const result = recorderUtils.createRecordingStream(
      { videoStream },
      { MediaStreamCtor: FakeMediaStream, AudioContextCtor: FakeAudioContext }
    );

    expect(result).toBeInstanceOf(FakeMediaStream);
    expect(result.getVideoTracks()).toEqual([videoTrack]);
    expect(result.getAudioTracks()).toEqual([]);
    expect(FakeAudioContext.instances).toHaveLength(0);
  });

  test('createRecordingStream appends system audio to the screen stream', async () => {
    const recorderUtils = await recorderUtilsPromise;
    const videoTrack = { kind: 'video', id: 'screen-video' };
    const screenAudioTrack = { kind: 'audio', id: 'screen-audio' };
    const videoStream = new FakeMediaStream([videoTrack]);
    const systemAudioStream = new FakeMediaStream([screenAudioTrack]);

    const result = recorderUtils.createRecordingStream(
      { videoStream, systemAudioStream },
      { MediaStreamCtor: FakeMediaStream, AudioContextCtor: FakeAudioContext }
    );

    expect(result.getVideoTracks()).toEqual([videoTrack]);
    expect(result.getAudioTracks()).toEqual([screenAudioTrack]);
    expect(FakeAudioContext.instances).toHaveLength(0);
  });

  test('createAudioRecordingStream returns mic-only tracks', async () => {
    const recorderUtils = await recorderUtilsPromise;
    const micTrack = { kind: 'audio', id: 'mic-audio' };
    const microphoneStream = new FakeMediaStream([micTrack]);

    const result = recorderUtils.createAudioRecordingStream(
      microphoneStream,
      { MediaStreamCtor: FakeMediaStream, AudioContextCtor: FakeAudioContext }
    );

    expect(result).toBeInstanceOf(FakeMediaStream);
    expect(result.getVideoTracks()).toEqual([]);
    expect(result.getAudioTracks()).toEqual([micTrack]);
    expect(FakeAudioContext.instances).toHaveLength(0);
  });

  test('resolveCaptureDeviceAudioInput matches capture card audio by group id, then label', async () => {
    const recorderUtils = await recorderUtilsPromise;

    expect(
      recorderUtils.resolveCaptureDeviceAudioInput('device:video-1', [
        { kind: 'videoinput', deviceId: 'video-1', groupId: 'group-1', label: 'Cam Link 4K' },
        { kind: 'audioinput', deviceId: 'audio-1', groupId: 'group-1', label: 'Unrelated Mic' }
      ])
    ).toEqual({ kind: 'audioinput', deviceId: 'audio-1', groupId: 'group-1', label: 'Unrelated Mic' });

    expect(
      recorderUtils.resolveCaptureDeviceAudioInput('device:video-2', [
        { kind: 'videoinput', deviceId: 'video-2', groupId: '', label: 'Cam Link 4K' },
        { kind: 'audioinput', deviceId: 'audio-2', groupId: '', label: 'Cam Link 4K Audio' }
      ])
    ).toEqual({ kind: 'audioinput', deviceId: 'audio-2', groupId: '', label: 'Cam Link 4K Audio' });
  });

  test('hasAudibleAudioSamples detects non-silent screen audio', async () => {
    const recorderUtils = await recorderUtilsPromise;

    expect(
      recorderUtils.hasAudibleAudioSamples([
        new Float32Array([0, 0.001, -0.005]),
        new Float32Array([0, 0.02, 0])
      ])
    ).toBe(true);
    expect(
      recorderUtils.hasAudibleAudioSamples([
        new Float32Array([0, 0.001, -0.005])
      ])
    ).toBe(false);
  });

  test('extractAudibleAudioSegments finds active windows in screen audio', async () => {
    const recorderUtils = await recorderUtilsPromise;

    const segments = recorderUtils.extractAudibleAudioSegments(
      [new Float32Array([0, 0, 0.04, 0.04, 0, 0, 0.03, 0.03, 0, 0])],
      100,
      { threshold: 0.02, windowMs: 20, minSegmentMs: 20 }
    );

    expect(segments).toEqual([
      { start: 0.02, end: 0.04 },
      { start: 0.06, end: 0.08 }
    ]);
  });

  test('mergeSectioningSegments combines speech and screen-audio intervals', async () => {
    const recorderUtils = await recorderUtilsPromise;

    expect(
      recorderUtils.mergeSectioningSegments(
        [{ start: 1, end: 2, text: 'hello' }],
        [{ start: 3, end: 4 }]
      )
    ).toEqual([
      { start: 1, end: 2, text: 'hello' },
      { start: 3, end: 4, text: '' }
    ]);
  });

  test('shouldSkipSpeechSectioning only disables cuts when screen audio is both present and audible', async () => {
    const recorderUtils = await recorderUtilsPromise;

    expect(
      recorderUtils.shouldSkipSpeechSectioning({
        screenHasAudio: true,
        screenHasAudibleAudio: false
      })
    ).toBe(false);
    expect(
      recorderUtils.shouldSkipSpeechSectioning({
        screenHasAudio: false,
        screenHasAudibleAudio: true
      })
    ).toBe(false);
    expect(
      recorderUtils.shouldSkipSpeechSectioning({
        screenHasAudio: true,
        screenHasAudibleAudio: true
      })
    ).toBe(true);
  });
});
