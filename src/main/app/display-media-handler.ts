import type { DesktopCapturer, Session } from 'electron';

/**
 * Display-media coordination: the renderer captures system/desktop audio via
 * `navigator.mediaDevices.getDisplayMedia({ audio: true, video: true })`,
 * which routes through Electron's `setDisplayMediaRequestHandler`. The picker
 * UI and source selection still live in the renderer, so we stash the chosen
 * source id from a preparatory IPC and pop it when the request arrives.
 */

let pendingSourceId: string | null = null;

/**
 * Store the desktop source id the renderer is about to request. The next
 * `getDisplayMedia` call pops this value and resolves with the matching
 * source + `audio: 'loopback'` for system audio capture.
 */
export function setPendingDisplayMediaSource(sourceId: string | null): void {
  pendingSourceId = typeof sourceId === 'string' && sourceId.trim() ? sourceId : null;
}

export function getPendingDisplayMediaSource(): string | null {
  return pendingSourceId;
}

/**
 * Register the display-media handler on the given session. Without this the
 * default Electron behavior is to deny `getDisplayMedia`, which would break
 * the system-audio capture path.
 */
export function registerDisplayMediaHandler({
  session,
  desktopCapturer
}: {
  session: Pick<Session, 'setDisplayMediaRequestHandler'>;
  desktopCapturer: Pick<DesktopCapturer, 'getSources'>;
}): void {
  if (typeof session.setDisplayMediaRequestHandler !== 'function') {
    return;
  }

  session.setDisplayMediaRequestHandler(async (_request, callback) => {
    const sourceId = pendingSourceId;
    pendingSourceId = null;
    if (!sourceId) {
      // No pending renderer selection - deny rather than surface a picker the
      // app cannot style or localize.
      callback({});
      return;
    }
    try {
      const sources = await desktopCapturer.getSources({ types: ['screen', 'window'] });
      const source = sources.find((s) => s.id === sourceId);
      if (!source) {
        callback({});
        return;
      }
      callback({ video: source, audio: 'loopback' });
    } catch (error) {
      console.error('[display-media] handler failed:', error);
      callback({});
    }
  });
}
