import { describe, test, expect, vi, beforeEach } from 'vitest';
import { cleanupAllMedia, stopStream } from '../../src/renderer/features/media-cleanup.js';

// --- helpers ----------------------------------------------------------------

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

function makeFullRefs() {
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
  };
}

// stub cancelAnimationFrame (not available in Node)
beforeEach(() => {
  globalThis.cancelAnimationFrame = vi.fn();
});

// --- stopStream -------------------------------------------------------------

describe('stopStream', () => {
  test('no-ops for null', () => {
    expect(() => stopStream(null)).not.toThrow();
  });

  test('no-ops for undefined', () => {
    expect(() => stopStream(undefined)).not.toThrow();
  });

  test('stops all tracks on a stream', () => {
    const stream = makeFakeStream(3);
    stopStream(stream);
    stream._tracks.forEach((t) => expect(t.stop).toHaveBeenCalledOnce());
  });

  test('does not throw when track.stop() throws', () => {
    const stream = {
      getTracks: () => [{ stop: () => { throw new Error('already stopped'); } }]
    };
    expect(() => stopStream(stream)).not.toThrow();
  });
});

// --- cleanupAllMedia --------------------------------------------------------

describe('cleanupAllMedia', () => {
  // Task 4.1: all-null resources does not throw
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
      recorders: [],
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
    };
    expect(() => cleanupAllMedia(refs)).not.toThrow();
  });

  test('called with empty object does not throw', () => {
    expect(() => cleanupAllMedia({})).not.toThrow();
  });

  // Idempotency — double call
  test('double call does not throw', () => {
    const refs = makeFullRefs();
    cleanupAllMedia(refs);
    expect(() => cleanupAllMedia(refs)).not.toThrow();
  });

  // Full cleanup
  test('stops all media streams', () => {
    const refs = makeFullRefs();
    const screenTracks = refs.screenStream._tracks;
    const cameraTracks = refs.cameraStream._tracks;
    const audioTracks = refs.audioStream._tracks;

    cleanupAllMedia(refs);

    screenTracks.forEach((t) => expect(t.stop).toHaveBeenCalledOnce());
    cameraTracks.forEach((t) => expect(t.stop).toHaveBeenCalledOnce());
    audioTracks.forEach((t) => expect(t.stop).toHaveBeenCalledOnce());
    expect(refs.screenStream).toBeNull();
    expect(refs.cameraStream).toBeNull();
    expect(refs.audioStream).toBeNull();
  });

  test('stops all MediaRecorders and empties array', () => {
    const refs = makeFullRefs();
    const recorders = refs.recorders;

    cleanupAllMedia(refs);

    recorders.forEach((r) => expect(r.stop).toHaveBeenCalledOnce());
    expect(refs.recorders).toEqual([]);
  });

  test('skips already-inactive recorders', () => {
    const refs = makeFullRefs();
    refs.recorders = [makeFakeRecorder('inactive')];

    cleanupAllMedia(refs);

    expect(refs.recorders[0]).toBeUndefined(); // array was emptied
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
    const node = refs.scribeWorkletNode;

    cleanupAllMedia(refs);

    expect(node.disconnect).toHaveBeenCalledOnce();
    expect(refs.scribeWorkletNode).toBeNull();
  });

  test('closes scribe WebSocket', () => {
    const refs = makeFullRefs();
    const ws = refs.scribeWs;

    cleanupAllMedia(refs);

    expect(ws.close).toHaveBeenCalledOnce();
    expect(refs.scribeWs).toBeNull();
  });

  test('calls stopAudioMeter and closes AudioContext', () => {
    const refs = makeFullRefs();
    const ctx = refs.audioContext;

    cleanupAllMedia(refs);

    expect(refs.stopAudioMeter).toHaveBeenCalledOnce();
    expect(ctx.close).toHaveBeenCalledOnce();
    expect(refs.audioContext).toBeNull();
  });

  test('cancels animation frames', () => {
    const refs = makeFullRefs();

    cleanupAllMedia(refs);

    expect(globalThis.cancelAnimationFrame).toHaveBeenCalledWith(1); // drawRAF
    expect(globalThis.cancelAnimationFrame).toHaveBeenCalledWith(2); // meterRAF
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
    expect(refs.recording).toBe(true);

    cleanupAllMedia(refs);

    expect(refs.recording).toBe(false);
  });
});
