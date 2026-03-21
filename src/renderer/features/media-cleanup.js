/**
 * Centralised, synchronous, idempotent cleanup for all renderer media
 * resources.  Called from the `beforeunload` handler so every `.stop()` /
 * `.close()` must be non-blocking.
 *
 * Usage in app.js:
 *   import { cleanupAllMedia } from './features/media-cleanup.js';
 *   // pass the mutable refs bag that app.js owns
 *   cleanupAllMedia(refs);
 */

/**
 * Stop every track on a MediaStream, then null-out the reference.
 * No-ops when the stream is already null / undefined.
 */
function stopStream(stream) {
  if (!stream) return;
  try {
    stream.getTracks().forEach((t) => t.stop());
  } catch (_) {
    /* already stopped or GC'd */
  }
}

/**
 * @param {object} refs  – mutable bag of media-resource references owned by app.js
 *
 * Expected keys (all optional / nullable):
 *   screenStream, cameraStream, audioStream,
 *   recorders,              // Array<MediaRecorder>
 *   screenRecInterval,      // setInterval id
 *   audioSendInterval,      // setInterval id
 *   timerInterval,          // setInterval id
 *   audioContext,           // AudioContext
 *   scribeWorkletNode,      // AudioWorkletNode
 *   scribeWs,              // WebSocket
 *   drawRAF,               // requestAnimationFrame id
 *   meterRAF,              // requestAnimationFrame id
 *   cancelEditorDrawLoop,  // function — existing helper from app.js
 *   stopAudioMeter,        // function — existing helper from app.js
 */
function cleanupAllMedia(refs) {
  if (!refs) return;

  // --- recording flag -------------------------------------------------------
  if (refs.recording) {
    refs.recording = false;
  }

  // --- intervals ------------------------------------------------------------
  if (refs.screenRecInterval) {
    clearInterval(refs.screenRecInterval);
    refs.screenRecInterval = null;
  }
  if (refs.audioSendInterval) {
    clearInterval(refs.audioSendInterval);
    refs.audioSendInterval = null;
  }
  if (refs.timerInterval) {
    clearInterval(refs.timerInterval);
    refs.timerInterval = null;
  }

  // --- MediaRecorders -------------------------------------------------------
  if (refs.recorders && refs.recorders.length) {
    refs.recorders.forEach((r) => {
      try {
        if (r.state !== 'inactive') r.stop();
      } catch (_) {
        /* already stopped */
      }
    });
    refs.recorders = [];
  }

  // --- Scribe audio worklet -------------------------------------------------
  if (refs.scribeWorkletNode) {
    try {
      refs.scribeWorkletNode.disconnect();
    } catch (_) {
      /* already disconnected */
    }
    refs.scribeWorkletNode = null;
  }

  // --- Scribe WebSocket -----------------------------------------------------
  if (refs.scribeWs) {
    try {
      refs.scribeWs.close();
    } catch (_) {
      /* already closed */
    }
    refs.scribeWs = null;
  }

  // --- Audio meter / context ------------------------------------------------
  if (typeof refs.stopAudioMeter === 'function') {
    try {
      refs.stopAudioMeter();
    } catch (_) {
      /* best-effort */
    }
  }

  // Close AudioContext if stopAudioMeter didn't already
  if (refs.audioContext) {
    try {
      refs.audioContext.close();
    } catch (_) {
      /* already closed */
    }
    refs.audioContext = null;
  }

  // --- Animation frames -----------------------------------------------------
  if (refs.drawRAF) {
    cancelAnimationFrame(refs.drawRAF);
    refs.drawRAF = null;
  }
  if (refs.meterRAF) {
    cancelAnimationFrame(refs.meterRAF);
    refs.meterRAF = null;
  }
  if (typeof refs.cancelEditorDrawLoop === 'function') {
    try {
      refs.cancelEditorDrawLoop();
    } catch (_) {
      /* best-effort */
    }
  }

  // --- Media streams (last – stops ScreenCaptureKit sessions) ---------------
  stopStream(refs.screenStream);
  refs.screenStream = null;

  stopStream(refs.cameraStream);
  refs.cameraStream = null;

  stopStream(refs.audioStream);
  refs.audioStream = null;
}

export { cleanupAllMedia, stopStream };
