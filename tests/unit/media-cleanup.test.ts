import { beforeEach, describe, expect, test, vi } from 'vitest';

import {
  cleanupAllMedia,
  stopStream,
  type MediaRefs
} from '../../src/renderer/features/media-cleanup';

function makeFakeStream(trackCount = 1) {
  const tracks = Array.from({ length: trackCount }, () => ({ stop: vi.fn() }));
  return { getTracks: () => tracks, _tracks: tracks };
}

function makeFakeRecorder(state = 'recording') {
  return { state, stop: vi.fn() };
}

function makeFakeAudioContext() {
  return { close: vi.fn() };
}

function makeFakeWorkletNode() {
  return { disconnect: vi.fn() };
}

function makeFakeWebSocket() {
  return { close: vi.fn() };
}

type FakeMediaRefs = MediaRefs & {
  screenStream: ReturnType<typeof makeFakeStream> | null;
  cameraStream: ReturnType<typeof makeFakeStream> | null;
  audioStream: ReturnType<typeof makeFakeStream> | null;
  recorders: ReturnType<typeof makeFakeRecorder>[];
  audioContext: ReturnType<typeof makeFakeAudioContext> | null;
  scribeWorkletNode: ReturnType<typeof makeFakeWorkletNode> | null;
  scribeWs: ReturnType<typeof makeFakeWebSocket> | null;
  cancelEditorDrawLoop: ReturnType<typeof vi.fn> | null;
  stopAudioMeter: ReturnType<typeof vi.fn> | null;
};

function makeFullRefs(): FakeMediaRefs {
  return {
    recording: true,
    screenStream: makeFakeStream(2),
    cameraStream: makeFakeStream(1),
    audioStream: makeFakeStream(1),
    recorders: [makeFakeRecorder('recording'), makeFakeRecorder('recording')],
    screenRecInterval: setInterval(() => {}, 100000),
    audioSendInterval: setInterval(() => {}, 100000),
    timerInterval: setInterval(() => {}, 100000),
    audioContext: makeFakeAudioContext(),
    scribeWorkletNode: makeFakeWorkletNode(),
    scribeWs: makeFakeWebSocket(),
    drawRAF: 1,
    meterRAF: 2,
    cancelEditorDrawLoop: vi.fn(),
    stopAudioMeter: vi.fn()
  } as FakeMediaRefs;
}

beforeEach(() => {
  globalThis.cancelAnimationFrame = vi.fn() as unknown as typeof globalThis.cancelAnimationFrame;
});

describe('stopStream', () => {
  test('no-ops for null', () => {
    expect(() => stopStream(null)).not.toThrow();
  });

  test('no-ops for undefined', () => {
    expect(() => stopStream(undefined)).not.toThrow();
  });

  test('stops all tracks on a stream', () => {
    const stream = makeFakeStream(3);
    stopStream(stream as unknown as MediaStream);
    stream._tracks.forEach((track) => expect(track.stop).toHaveBeenCalledOnce());
  });

  test('does not throw when track.stop() throws', () => {
    const stream = {
      getTracks: () => [
        {
          stop: () => {
            throw new Error('already stopped');
          }
        }
      ]
    };
    expect(() => stopStream(stream as unknown as MediaStream)).not.toThrow();
  });
});

describe('cleanupAllMedia', () => {
  test('called with null refs does not throw', () => {
    expect(() => cleanupAllMedia(null)).not.toThrow();
  });

  test('called with undefined refs does not throw', () => {
    expect(() => cleanupAllMedia(undefined)).not.toThrow();
  });

  test('called with all-null resource refs does not throw', () => {
    const refs = {
      recording: false,
      screenStream: null,
      cameraStream: null,
      audioStream: null,
      recorders: [] as ReturnType<typeof makeFakeRecorder>[],
      screenRecInterval: null,
      audioSendInterval: null,
      timerInterval: null,
      audioContext: null,
      scribeWorkletNode: null,
      scribeWs: null,
      drawRAF: null,
      meterRAF: null,
      cancelEditorDrawLoop: null,
      stopAudioMeter: null
    } as FakeMediaRefs;
    expect(() => cleanupAllMedia(refs)).not.toThrow();
  });

  test('called with empty object does not throw', () => {
    expect(() => cleanupAllMedia({} as MediaRefs)).not.toThrow();
  });

  test('double call does not throw', () => {
    const refs = makeFullRefs();
    cleanupAllMedia(refs);
    expect(() => cleanupAllMedia(refs)).not.toThrow();
  });

  test('stops all media streams', () => {
    const refs = makeFullRefs();
    const screenTracks = refs.screenStream!._tracks;
    const cameraTracks = refs.cameraStream!._tracks;
    const audioTracks = refs.audioStream!._tracks;

    cleanupAllMedia(refs);

    screenTracks.forEach((track) => expect(track.stop).toHaveBeenCalledOnce());
    cameraTracks.forEach((track) => expect(track.stop).toHaveBeenCalledOnce());
    audioTracks.forEach((track) => expect(track.stop).toHaveBeenCalledOnce());
    expect(refs.screenStream).toBeNull();
    expect(refs.cameraStream).toBeNull();
    expect(refs.audioStream).toBeNull();
  });

  test('stops active media recorders and empties the array', () => {
    const refs = makeFullRefs();
    const recorders = refs.recorders;

    cleanupAllMedia(refs);

    recorders.forEach((recorder) => expect(recorder.stop).toHaveBeenCalledOnce());
    expect(refs.recorders).toEqual([]);
  });

  test('skips already inactive recorders', () => {
    const refs = makeFullRefs();
    refs.recorders = [makeFakeRecorder('inactive')] as FakeMediaRefs['recorders'];

    cleanupAllMedia(refs);

    expect(refs.recorders).toEqual([]);
  });

  test('clears intervals and nulls refs', () => {
    const refs = makeFullRefs();

    cleanupAllMedia(refs);

    expect(refs.screenRecInterval).toBeNull();
    expect(refs.audioSendInterval).toBeNull();
    expect(refs.timerInterval).toBeNull();
  });

  test('disconnects scribe worklet node', () => {
    const refs = makeFullRefs();
    const node = refs.scribeWorkletNode!;

    cleanupAllMedia(refs);

    expect(node.disconnect).toHaveBeenCalledOnce();
    expect(refs.scribeWorkletNode).toBeNull();
  });

  test('closes scribe websocket', () => {
    const refs = makeFullRefs();
    const socket = refs.scribeWs!;

    cleanupAllMedia(refs);

    expect(socket.close).toHaveBeenCalledOnce();
    expect(refs.scribeWs).toBeNull();
  });

  test('calls stopAudioMeter and closes the audio context', () => {
    const refs = makeFullRefs();
    const audioContext = refs.audioContext!;

    cleanupAllMedia(refs);

    expect(refs.stopAudioMeter).toHaveBeenCalledOnce();
    expect(audioContext.close).toHaveBeenCalledOnce();
    expect(refs.audioContext).toBeNull();
  });

  test('cancels animation frames', () => {
    const refs = makeFullRefs();

    cleanupAllMedia(refs);

    expect(globalThis.cancelAnimationFrame).toHaveBeenCalledWith(1);
    expect(globalThis.cancelAnimationFrame).toHaveBeenCalledWith(2);
    expect(refs.drawRAF).toBeNull();
    expect(refs.meterRAF).toBeNull();
  });

  test('calls cancelEditorDrawLoop', () => {
    const refs = makeFullRefs();

    cleanupAllMedia(refs);

    expect(refs.cancelEditorDrawLoop).toHaveBeenCalledOnce();
  });

  test('sets recording to false', () => {
    const refs = makeFullRefs();

    cleanupAllMedia(refs);

    expect(refs.recording).toBe(false);
  });
});
