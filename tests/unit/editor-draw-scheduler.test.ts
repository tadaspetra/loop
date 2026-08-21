import { describe, expect, test } from 'vitest';

import {
  resolveEditorDrawSchedule,
  shouldRequestEditorDraw
} from '../../src/renderer/features/timeline/editor-draw-scheduler';

describe('renderer/features/timeline/editor-draw-scheduler', () => {
  test('paused editors remain idle until explicitly invalidated', () => {
    expect(
      resolveEditorDrawSchedule({
        playing: false,
        hasActiveVideo: true,
        supportsVideoFrameCallback: true
      })
    ).toBe('idle');

    expect(
      shouldRequestEditorDraw({
        hasEditor: true,
        timelineVisible: true,
        drawPending: false
      })
    ).toBe(true);
  });

  test('coalesces paused invalidations while a frame is pending', () => {
    expect(
      shouldRequestEditorDraw({
        hasEditor: true,
        timelineVisible: true,
        drawPending: true
      })
    ).toBe(false);
  });

  test('uses video frames during playback with an animation-frame fallback', () => {
    expect(
      resolveEditorDrawSchedule({
        playing: true,
        hasActiveVideo: true,
        supportsVideoFrameCallback: true
      })
    ).toBe('video-frame');
    expect(
      resolveEditorDrawSchedule({
        playing: true,
        hasActiveVideo: true,
        supportsVideoFrameCallback: false
      })
    ).toBe('animation-frame');
    expect(
      resolveEditorDrawSchedule({
        playing: true,
        hasActiveVideo: false,
        supportsVideoFrameCallback: false
      })
    ).toBe('animation-frame');
  });

  test('does not request draws outside the visible timeline', () => {
    expect(
      shouldRequestEditorDraw({
        hasEditor: true,
        timelineVisible: false,
        drawPending: false
      })
    ).toBe(false);
  });
});
