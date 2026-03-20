import { describe, test, expect } from 'vitest';
import {
  getOverlayStateAtTime
} from '../../src/renderer/features/timeline/overlay-utils.js';

function makeOverlay(overrides = {}) {
  return {
    id: 'o1',
    mediaPath: 'overlay-media/img.png',
    mediaType: 'image',
    startTime: 5,
    endTime: 10,
    sourceStart: 0,
    sourceEnd: 5,
    landscape: { x: 200, y: 100, width: 400, height: 300 },
    reel: { x: 50, y: 200, width: 300, height: 200 },
    ...overrides
  };
}

describe('renderer/features/timeline/overlay-utils', () => {
  test('returns inactive when no overlays', () => {
    expect(getOverlayStateAtTime(5, [], 'landscape')).toEqual({ active: false });
    expect(getOverlayStateAtTime(5, null, 'landscape')).toEqual({ active: false });
  });

  test('returns inactive when time is outside all overlay ranges', () => {
    const overlays = [makeOverlay({ startTime: 5, endTime: 10 })];
    expect(getOverlayStateAtTime(3, overlays, 'landscape').active).toBe(false);
    expect(getOverlayStateAtTime(12, overlays, 'landscape').active).toBe(false);
  });

  test('returns active with full opacity when well within range', () => {
    const overlays = [makeOverlay({ startTime: 5, endTime: 10 })];
    const state = getOverlayStateAtTime(7, overlays, 'landscape');
    expect(state.active).toBe(true);
    expect(state.opacity).toBe(1);
    expect(state.overlayId).toBe('o1');
    expect(state.x).toBe(200);
    expect(state.y).toBe(100);
    expect(state.width).toBe(400);
    expect(state.height).toBe(300);
  });

  test('fade in during TRANSITION_DURATION at start', () => {
    const overlays = [makeOverlay({ startTime: 5, endTime: 10 })];
    const state = getOverlayStateAtTime(5.15, overlays, 'landscape');
    expect(state.active).toBe(true);
    expect(state.opacity).toBeCloseTo(0.5, 1);
  });

  test('fade out during TRANSITION_DURATION at end', () => {
    const overlays = [makeOverlay({ startTime: 5, endTime: 10 })];
    const state = getOverlayStateAtTime(9.85, overlays, 'landscape');
    expect(state.active).toBe(true);
    expect(state.opacity).toBeCloseTo(0.5, 1);
  });

  test('uses reel mode position when outputMode is reel', () => {
    const overlays = [makeOverlay()];
    const state = getOverlayStateAtTime(7, overlays, 'reel');
    expect(state.x).toBe(50);
    expect(state.y).toBe(200);
    expect(state.width).toBe(300);
    expect(state.height).toBe(200);
  });

  test('computes sourceTime for video overlays', () => {
    const overlays = [makeOverlay({ mediaType: 'video', sourceStart: 10, sourceEnd: 15 })];
    const state = getOverlayStateAtTime(7, overlays, 'landscape');
    expect(state.sourceTime).toBe(12);
  });

  test('sourceTime is 0 for image overlays', () => {
    const overlays = [makeOverlay({ mediaType: 'image' })];
    const state = getOverlayStateAtTime(7, overlays, 'landscape');
    expect(state.sourceTime).toBe(0);
  });

  test('first segment stays at own position approaching boundary (no interpolation)', () => {
    const overlays = [
      makeOverlay({ id: 'o1', startTime: 5, endTime: 10, landscape: { x: 100, y: 100, width: 400, height: 300 } }),
      makeOverlay({ id: 'o2', startTime: 10, endTime: 15, landscape: { x: 500, y: 300, width: 400, height: 300 } })
    ];
    const state = getOverlayStateAtTime(9.85, overlays, 'landscape');
    expect(state.active).toBe(true);
    expect(state.opacity).toBe(1);
    // First segment does NOT interpolate — stays at its own position
    expect(state.x).toBe(100);
    expect(state.y).toBe(100);
  });

  test('interpolates position between adjacent same-media segments past boundary', () => {
    const overlays = [
      makeOverlay({ id: 'o1', startTime: 5, endTime: 10, landscape: { x: 100, y: 100, width: 400, height: 300 } }),
      makeOverlay({ id: 'o2', startTime: 10, endTime: 15, landscape: { x: 500, y: 300, width: 400, height: 300 } })
    ];
    const state = getOverlayStateAtTime(10.15, overlays, 'landscape');
    expect(state.active).toBe(true);
    expect(state.overlayId).toBe('o2');
    expect(state.opacity).toBe(1);
    expect(state.x).toBeCloseTo(300, 0);
    expect(state.y).toBeCloseTo(200, 0);
  });

  test('no position interpolation for different-media adjacent segments', () => {
    const overlays = [
      makeOverlay({ id: 'o1', mediaPath: 'a.png', startTime: 5, endTime: 10, landscape: { x: 100, y: 100, width: 400, height: 300 } }),
      makeOverlay({ id: 'o2', mediaPath: 'b.png', startTime: 10, endTime: 15, landscape: { x: 500, y: 300, width: 400, height: 300 } })
    ];
    const state = getOverlayStateAtTime(9.85, overlays, 'landscape');
    expect(state.x).toBe(100);
    expect(state.opacity).toBeCloseTo(0.5, 1);
  });
});
