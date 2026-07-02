/**
 * Close guard: pure decision state for "can the window close right now?".
 *
 * The renderer keeps main informed via the fire-and-forget
 * `recording:set-active` IPC channel whenever recording starts/stops, so the
 * BrowserWindow 'close' handler can decide synchronously (no renderer
 * round-trip) whether to intercept the close.
 *
 * When a close is intercepted, the renderer is asked (via
 * `app:close-requested`) to stop/finalize the recording and then confirm the
 * real close with `app:confirm-close`, which arms a one-shot bypass before
 * `win.close()` re-fires the 'close' event.
 */

export type CloseRequestDecision = 'allow' | 'prevent';

export interface CloseGuard {
  /** Renderer-driven recording state; coerced to a strict boolean. */
  setRecordingActive(active: boolean): void;
  isRecordingActive(): boolean;
  /**
   * Arm a one-shot bypass so the next close request is allowed even if the
   * recording flag is still set (e.g. stopRecording threw — the bytes are in
   * the .part file and recoverable, so the user must never be trapped).
   */
  confirmClose(): void;
  /** Decide the fate of a window 'close' event. Consumes the bypass. */
  handleCloseRequest(): CloseRequestDecision;
}

export function createCloseGuard(): CloseGuard {
  let recordingActive = false;
  let closeConfirmed = false;

  return {
    setRecordingActive(active: boolean): void {
      recordingActive = Boolean(active);
    },
    isRecordingActive(): boolean {
      return recordingActive;
    },
    confirmClose(): void {
      closeConfirmed = true;
    },
    handleCloseRequest(): CloseRequestDecision {
      if (closeConfirmed) {
        closeConfirmed = false;
        return 'allow';
      }
      return recordingActive ? 'prevent' : 'allow';
    }
  };
}
