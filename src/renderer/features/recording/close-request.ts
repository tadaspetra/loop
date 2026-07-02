/**
 * Decision logic for the main-process "window close requested" event.
 *
 * Main only asks the renderer when its recording flag is set, but the
 * renderer re-checks its own live state: the flag can be stale (recording
 * finished a beat earlier) or recorders can still be draining/finalizing
 * after `recording` flipped false.
 */

export const CLOSE_PROMPT_MESSAGE =
  'Recording in progress — stop and save before quitting?';

export type CloseRequestedAction = 'close-immediately' | 'confirm-stop-then-close';

export function getCloseRequestedAction({
  recording,
  hasActiveRecorders
}: {
  recording: boolean;
  hasActiveRecorders: boolean;
}): CloseRequestedAction {
  return recording || hasActiveRecorders ? 'confirm-stop-then-close' : 'close-immediately';
}
