import { describe, expect, test } from 'vitest';

import {
  AUTHORING_CANVAS_H,
  AUTHORING_CANVAS_W,
  computeScreenPlacement,
  defaultScreenTransform,
  MAX_SCREEN_TRANSFORM_SCALE,
  MIN_SCREEN_TRANSFORM_SCALE,
  normalizeScreenTransform
} from '../../src/shared/domain/screen-layout';

describe('shared/domain/screen-layout', () => {
  test('normalizeScreenTransform returns null for missing or malformed input', () => {
    expect(normalizeScreenTransform(null)).toBeNull();
    expect(normalizeScreenTransform(undefined)).toBeNull();
    expect(normalizeScreenTransform('free')).toBeNull();
    expect(normalizeScreenTransform({})).toBeNull();
    expect(normalizeScreenTransform({ x: 100, y: 100 })).toBeNull();
    expect(normalizeScreenTransform({ x: NaN, y: 0, scale: 1 })).toBeNull();
    expect(normalizeScreenTransform({ x: 100, y: 100, scale: 0 })).toBeNull();
    expect(normalizeScreenTransform({ x: 100, y: 100, scale: -2 })).toBeNull();
  });

  test('normalizeScreenTransform clamps center into the authoring canvas and scale into bounds', () => {
    expect(normalizeScreenTransform({ x: -500, y: 5000, scale: 99 })).toEqual({
      x: 0,
      y: AUTHORING_CANVAS_H,
      scale: MAX_SCREEN_TRANSFORM_SCALE
    });
    expect(normalizeScreenTransform({ x: 960, y: 540, scale: 0.0001 })).toEqual({
      x: 960,
      y: 540,
      scale: MIN_SCREEN_TRANSFORM_SCALE
    });
  });

  test('normalizeScreenTransform passes through valid transforms with numeric coercion', () => {
    expect(normalizeScreenTransform({ x: '800', y: '400', scale: '1.5' })).toEqual({
      x: 800,
      y: 400,
      scale: 1.5
    });
  });

  test('computeScreenPlacement fill covers the canvas, centered', () => {
    // 16:10 source (e.g. MacBook) on a 16:9 canvas: cover crops top/bottom.
    const placement = computeScreenPlacement(3456, 2234, 1920, 1080, 'fill', null);
    expect(placement).not.toBeNull();
    const scale = Math.max(1920 / 3456, 1080 / 2234);
    expect(placement?.width).toBeCloseTo(3456 * scale, 6);
    expect(placement?.height).toBeCloseTo(2234 * scale, 6);
    expect(placement!.left + placement!.width / 2).toBeCloseTo(960, 6);
    expect(placement!.top + placement!.height / 2).toBeCloseTo(540, 6);
  });

  test('computeScreenPlacement fit letterboxes inside the canvas, centered', () => {
    const placement = computeScreenPlacement(3456, 2234, 1920, 1080, 'fit', null);
    const scale = Math.min(1920 / 3456, 1080 / 2234);
    expect(placement?.width).toBeCloseTo(3456 * scale, 6);
    expect(placement?.height).toBeCloseTo(2234 * scale, 6);
    expect(placement!.left).toBeGreaterThanOrEqual(0);
    expect(placement!.top).toBeGreaterThanOrEqual(0);
  });

  test('computeScreenPlacement applies the transform relative to the fit size', () => {
    // scale=1 at canvas center is identical to fit mode.
    const fitPlacement = computeScreenPlacement(3840, 2160, 1920, 1080, 'fill', {
      x: 960,
      y: 540,
      scale: 1
    });
    expect(fitPlacement?.width).toBeCloseTo(1920, 6);
    expect(fitPlacement?.height).toBeCloseTo(1080, 6);
    expect(fitPlacement?.left).toBeCloseTo(0, 6);
    expect(fitPlacement?.top).toBeCloseTo(0, 6);

    const placement = computeScreenPlacement(3840, 2160, 1920, 1080, 'fill', {
      x: 480,
      y: 270,
      scale: 0.5
    });
    expect(placement?.width).toBeCloseTo(960, 6);
    expect(placement?.height).toBeCloseTo(540, 6);
    expect(placement?.left).toBeCloseTo(0, 6);
    expect(placement?.top).toBeCloseTo(0, 6);
  });

  test('computeScreenPlacement scales transform coordinates for larger 16:9 canvases', () => {
    // Same transform on a 2× canvas doubles every placement value.
    const transform = { x: 480, y: 270, scale: 0.5 };
    const base = computeScreenPlacement(3840, 2160, 1920, 1080, 'fill', transform);
    const doubled = computeScreenPlacement(3840, 2160, 3840, 2160, 'fill', transform);
    expect(doubled?.width).toBeCloseTo(base!.width * 2, 6);
    expect(doubled?.height).toBeCloseTo(base!.height * 2, 6);
    expect(doubled?.left).toBeCloseTo(base!.left * 2, 6);
    expect(doubled?.top).toBeCloseTo(base!.top * 2, 6);
  });

  test('computeScreenPlacement returns null for invalid dimensions', () => {
    expect(computeScreenPlacement(0, 1080, 1920, 1080, 'fill', null)).toBeNull();
    expect(computeScreenPlacement(1920, -5, 1920, 1080, 'fill', null)).toBeNull();
    expect(computeScreenPlacement(1920, 1080, 0, 0, 'fill', null)).toBeNull();
  });

  test('defaultScreenTransform mirrors the legacy fill and fit placements', () => {
    // fit: scale 1 centered.
    expect(defaultScreenTransform('fit', 3456, 2234)).toEqual({
      x: AUTHORING_CANVAS_W / 2,
      y: AUTHORING_CANVAS_H / 2,
      scale: 1
    });

    // fill: scale = cover/fit ratio so the placement equals the cover rect.
    const fill = defaultScreenTransform('fill', 3456, 2234);
    const placement = computeScreenPlacement(3456, 2234, 1920, 1080, 'fill', fill);
    const legacy = computeScreenPlacement(3456, 2234, 1920, 1080, 'fill', null);
    expect(placement?.width).toBeCloseTo(legacy!.width, 6);
    expect(placement?.height).toBeCloseTo(legacy!.height, 6);
    expect(placement?.left).toBeCloseTo(legacy!.left, 6);
    expect(placement?.top).toBeCloseTo(legacy!.top, 6);
  });

  test('defaultScreenTransform clamps the fill ratio into the allowed scale range', () => {
    // Extremely wide source: cover/fit ratio would exceed the max scale.
    const transform = defaultScreenTransform('fill', 10000, 100);
    expect(transform.scale).toBeLessThanOrEqual(MAX_SCREEN_TRANSFORM_SCALE);
    expect(transform.scale).toBeGreaterThanOrEqual(MIN_SCREEN_TRANSFORM_SCALE);
  });
});
