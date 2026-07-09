export interface MediaRefs {
  recording?: boolean;
  screenStream?: MediaStream | null;
  cameraStream?: MediaStream | null;
  audioStream?: MediaStream | null;
  recorders?: MediaRecorder[];
  screenRecInterval?: ReturnType<typeof setInterval> | null;
  timerInterval?: ReturnType<typeof setInterval> | null;
  audioContext?: AudioContext | null;
  drawRAF?: number | null;
  meterRAF?: number | null;
  cancelEditorDrawLoop?: (() => void) | null;
  stopAudioMeter?: (() => void) | null;
}

export function stopStream(stream: MediaStream | null | undefined): void {
  if (!stream) return;

  try {
    stream.getTracks().forEach((track) => track.stop());
  } catch {
    // Best-effort cleanup for already-stopped or torn-down streams.
  }
}

export function cleanupAllMedia(refs: MediaRefs | null | undefined): void {
  if (!refs) return;

  if (refs.recording) {
    refs.recording = false;
  }

  if (refs.screenRecInterval) {
    clearInterval(refs.screenRecInterval);
    refs.screenRecInterval = null;
  }
  if (refs.timerInterval) {
    clearInterval(refs.timerInterval);
    refs.timerInterval = null;
  }

  if (refs.recorders && refs.recorders.length > 0) {
    refs.recorders.forEach((recorder) => {
      try {
        if (recorder.state !== 'inactive') recorder.stop();
      } catch {
        // Already stopped.
      }
    });
    refs.recorders = [];
  }

  if (typeof refs.stopAudioMeter === 'function') {
    try {
      refs.stopAudioMeter();
    } catch {
      // Best-effort cleanup.
    }
  }

  if (refs.audioContext) {
    try {
      // stopAudioMeter (called above via refs.stopAudioMeter) may already
      // have closed this context; close() on a closed context REJECTS its
      // promise, which a sync try/catch cannot intercept. Guard on state and
      // swallow the rejection.
      if (refs.audioContext.state !== 'closed') {
        const closing = refs.audioContext.close();
        if (closing && typeof closing.catch === 'function') closing.catch(() => {});
      }
    } catch {
      // Already closed or torn down.
    }
    refs.audioContext = null;
  }

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
    } catch {
      // Best-effort cleanup.
    }
  }

  stopStream(refs.screenStream);
  refs.screenStream = null;

  stopStream(refs.cameraStream);
  refs.cameraStream = null;

  stopStream(refs.audioStream);
  refs.audioStream = null;
}
