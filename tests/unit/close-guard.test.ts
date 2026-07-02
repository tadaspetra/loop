import { describe, expect, test } from 'vitest';

import { createCloseGuard } from '../../src/main/app/close-guard';

describe('main/app/close-guard', () => {
  test('allows close when no recording is active', () => {
    const guard = createCloseGuard();

    expect(guard.isRecordingActive()).toBe(false);
    expect(guard.handleCloseRequest()).toBe('allow');
  });

  test('prevents close while a recording is active', () => {
    const guard = createCloseGuard();

    guard.setRecordingActive(true);

    expect(guard.isRecordingActive()).toBe(true);
    expect(guard.handleCloseRequest()).toBe('prevent');
    // The decision is repeatable: a prevented close does not mutate the flag.
    expect(guard.handleCloseRequest()).toBe('prevent');
  });

  test('allows close again after recording stops', () => {
    const guard = createCloseGuard();

    guard.setRecordingActive(true);
    guard.setRecordingActive(false);

    expect(guard.isRecordingActive()).toBe(false);
    expect(guard.handleCloseRequest()).toBe('allow');
  });

  test('coerces non-boolean recording state to a boolean', () => {
    const guard = createCloseGuard();

    guard.setRecordingActive(1 as unknown as boolean);
    expect(guard.isRecordingActive()).toBe(true);

    guard.setRecordingActive(0 as unknown as boolean);
    expect(guard.isRecordingActive()).toBe(false);
  });

  test('confirmClose bypasses the guard exactly once, even while recording', () => {
    const guard = createCloseGuard();

    guard.setRecordingActive(true);
    guard.confirmClose();

    // The confirmed close goes through even though the recording flag is
    // still set (resilience: if stopRecording failed, the user can still
    // close — bytes are in the .part file and recoverable).
    expect(guard.handleCloseRequest()).toBe('allow');
    // The bypass is one-shot: a later close request is guarded again.
    expect(guard.handleCloseRequest()).toBe('prevent');
  });

  test('confirmClose on an idle guard does not leave a stale bypass behind', () => {
    const guard = createCloseGuard();

    guard.confirmClose();
    expect(guard.handleCloseRequest()).toBe('allow');

    guard.setRecordingActive(true);
    expect(guard.handleCloseRequest()).toBe('prevent');
  });
});
