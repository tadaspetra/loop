import { describe, expect, test } from 'vitest';

import {
  CLOSE_PROMPT_MESSAGE,
  getCloseRequestedAction
} from '../../src/renderer/features/recording/close-request';

describe('renderer/features/recording/close-request', () => {
  test('requests confirm-stop-then-close while recording', () => {
    expect(getCloseRequestedAction({ recording: true, hasActiveRecorders: true })).toBe(
      'confirm-stop-then-close'
    );
  });

  test('requests confirm-stop-then-close when recorders are still draining', () => {
    // recording flips false at the end of stop, but recorders can still be
    // finalizing; the close must wait for them too.
    expect(getCloseRequestedAction({ recording: false, hasActiveRecorders: true })).toBe(
      'confirm-stop-then-close'
    );
  });

  test('closes immediately when nothing is recording (stale main-side flag)', () => {
    expect(getCloseRequestedAction({ recording: false, hasActiveRecorders: false })).toBe(
      'close-immediately'
    );
  });

  test('prompt copy explains that stopping saves the recording', () => {
    expect(CLOSE_PROMPT_MESSAGE).toMatch(/recording in progress/i);
    expect(CLOSE_PROMPT_MESSAGE).toMatch(/stop and save/i);
  });
});
