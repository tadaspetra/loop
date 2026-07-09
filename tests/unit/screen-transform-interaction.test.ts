import { describe, expect, test } from 'vitest';

import {
  clientPointToCanvasCoords,
  cursorForScreenHit,
  getWorkspaceView,
  HANDLE_EDGE_INSET,
  handleAnchorPoints,
  hitTestScreenPlacement,
  moveScreenTransform,
  oppositeCorner,
  resizeScreenTransform,
  SCREEN_HANDLE_HIT_SIZE,
  SCREEN_SNAP_THRESHOLD,
  snapMovedScreenTransform,
  snapResizeCursor,
  workspaceToEditorCoords,
  WORKSPACE_VIEW_SCALE
} from '../../src/renderer/features/editor/screen-transform';
import type { ScreenPlacement } from '../../src/shared/domain/screen-layout';

const placement: ScreenPlacement = { left: 480, top: 270, width: 960, height: 540 };

describe('renderer/features/editor/screen-transform', () => {
  test('hitTestScreenPlacement prefers corner handles over the body', () => {
    expect(hitTestScreenPlacement(480, 270, placement)).toEqual({
      kind: 'handle',
      corner: 'nw'
    });
    expect(hitTestScreenPlacement(1440, 810, placement)).toEqual({
      kind: 'handle',
      corner: 'se'
    });
    // Slightly inside the corner hit box still counts as a handle.
    expect(
      hitTestScreenPlacement(
        1440 - SCREEN_HANDLE_HIT_SIZE / 4,
        270 + SCREEN_HANDLE_HIT_SIZE / 4,
        placement
      )
    ).toEqual({ kind: 'handle', corner: 'ne' });
    expect(hitTestScreenPlacement(960, 540, placement)).toEqual({ kind: 'body' });
    expect(hitTestScreenPlacement(100, 100, placement)).toBeNull();
    expect(hitTestScreenPlacement(960, 540, null)).toBeNull();
  });

  test('handleAnchorPoints clamps handles into the frame when the placement overflows', () => {
    // Fill-mode 16:10 capture: the cover placement overflows the 16:9 frame
    // vertically, so the true corners sit off-canvas.
    const overflow: ScreenPlacement = { left: 0, top: -80, width: 1920, height: 1240 };
    const clamped = handleAnchorPoints(overflow);
    for (const point of clamped) {
      expect(point.x).toBeGreaterThanOrEqual(HANDLE_EDGE_INSET);
      expect(point.x).toBeLessThanOrEqual(1920 - HANDLE_EDGE_INSET);
      expect(point.y).toBeGreaterThanOrEqual(HANDLE_EDGE_INSET);
      expect(point.y).toBeLessThanOrEqual(1080 - HANDLE_EDGE_INSET);
    }
    // Unclamped (workspace view) returns the true corners.
    const raw = handleAnchorPoints(overflow, false);
    expect(raw.find((p) => p.corner === 'nw')).toEqual({ corner: 'nw', x: 0, y: -80 });
  });

  test('hitTestScreenPlacement grabs a corner even when the true corner is off-frame', () => {
    const overflow: ScreenPlacement = { left: 0, top: -80, width: 1920, height: 1240 };
    // The nw handle is clamped to (inset, inset); clicking near the frame's
    // top-left corner must start a resize, not a move.
    expect(hitTestScreenPlacement(HANDLE_EDGE_INSET, HANDLE_EDGE_INSET, overflow)).toEqual({
      kind: 'handle',
      corner: 'nw'
    });
    expect(hitTestScreenPlacement(1920 - HANDLE_EDGE_INSET, 1080 - HANDLE_EDGE_INSET, overflow)).toEqual({
      kind: 'handle',
      corner: 'se'
    });
  });

  test('moveScreenTransform shifts the center and clamps to the canvas', () => {
    const moved = moveScreenTransform({ x: 960, y: 540, scale: 0.5 }, -200, 100);
    expect(moved).toEqual({ x: 760, y: 640, scale: 0.5 });

    const clamped = moveScreenTransform({ x: 100, y: 100, scale: 0.5 }, -500, -500);
    expect(clamped.x).toBe(0);
    expect(clamped.y).toBe(0);
  });

  test('resizeScreenTransform grows around the fixed anchor corner, aspect-locked', () => {
    // 16:9 source: fit size equals the canvas (1920x1080). Dragging the SE
    // corner from the NW anchor at (480, 270) out to (1440, 810) spans
    // 960x540 → scale 0.5, centered between anchor and cursor.
    const resized = resizeScreenTransform({
      corner: 'se',
      anchorX: 480,
      anchorY: 270,
      cursorX: 1440,
      cursorY: 810,
      sourceW: 3840,
      sourceH: 2160
    });
    expect(resized).not.toBeNull();
    expect(resized!.scale).toBeCloseTo(0.5, 6);
    expect(resized!.x).toBeCloseTo(960, 6);
    expect(resized!.y).toBeCloseTo(540, 6);

    // The wider axis wins: pulling mostly horizontally still scales uniformly.
    const wide = resizeScreenTransform({
      corner: 'se',
      anchorX: 0,
      anchorY: 0,
      cursorX: 1920,
      cursorY: 100,
      sourceW: 3840,
      sourceH: 2160
    });
    expect(wide!.scale).toBeCloseTo(1, 6);
  });

  test('resizeScreenTransform clamps scale into the allowed range', () => {
    const tiny = resizeScreenTransform({
      corner: 'se',
      anchorX: 960,
      anchorY: 540,
      cursorX: 961,
      cursorY: 541,
      sourceW: 3840,
      sourceH: 2160
    });
    expect(tiny!.scale).toBeCloseTo(0.1, 6);

    const invalid = resizeScreenTransform({
      corner: 'se',
      anchorX: 0,
      anchorY: 0,
      cursorX: 100,
      cursorY: 100,
      sourceW: 0,
      sourceH: 0
    });
    expect(invalid).toBeNull();
  });

  test('oppositeCorner returns the fixed anchor for a dragged corner', () => {
    expect(oppositeCorner(placement, 'se')).toEqual({ corner: 'nw', x: 480, y: 270 });
    expect(oppositeCorner(placement, 'nw')).toEqual({ corner: 'se', x: 1440, y: 810 });
    expect(oppositeCorner(placement, 'ne')).toEqual({ corner: 'sw', x: 480, y: 810 });
  });

  test('clientPointToCanvasCoords maps through object-contain letterboxing', () => {
    // Wider-than-16:9 container: the bitmap is pillarboxed. scale = 500/1080,
    // content width = 1920 * scale ≈ 888.9, centered with ~55.6px bars.
    const wide = { left: 100, top: 50, width: 1000, height: 500 };
    const scale = 500 / 1080;
    const barX = (1000 - 1920 * scale) / 2;

    const topLeft = clientPointToCanvasCoords(100 + barX, 50, wide);
    expect(topLeft.x).toBeCloseTo(0, 6);
    expect(topLeft.y).toBeCloseTo(0, 6);

    const center = clientPointToCanvasCoords(100 + 500, 50 + 250, wide);
    expect(center.x).toBeCloseTo(960, 6);
    expect(center.y).toBeCloseTo(540, 6);

    const bottomRight = clientPointToCanvasCoords(100 + 1000 - barX, 50 + 500, wide);
    expect(bottomRight.x).toBeCloseTo(1920, 6);
    expect(bottomRight.y).toBeCloseTo(1080, 6);

    // Taller-than-16:9 container: letterboxed top/bottom instead.
    const tall = { left: 0, top: 0, width: 960, height: 800 };
    const tallScale = 960 / 1920;
    const barY = (800 - 1080 * tallScale) / 2;
    const corner = clientPointToCanvasCoords(0, barY, tall);
    expect(corner.x).toBeCloseTo(0, 6);
    expect(corner.y).toBeCloseTo(0, 6);

    // Degenerate rects do not divide by zero.
    expect(clientPointToCanvasCoords(10, 10, { left: 0, top: 0, width: 0, height: 0 })).toEqual({
      x: 0,
      y: 0
    });
  });

  test('workspaceToEditorCoords inverts the zoomed-out draw transform', () => {
    const view = getWorkspaceView();
    // The frame's top-left corner is drawn at the workspace offset.
    expect(workspaceToEditorCoords(view.offsetX, view.offsetY, view)).toEqual({ x: 0, y: 0 });
    // The canvas center maps to the editor center (the view is centered).
    const center = workspaceToEditorCoords(960, 540, view);
    expect(center.x).toBeCloseTo(960, 6);
    expect(center.y).toBeCloseTo(540, 6);
    // Round trip: editor point p draws at p*scale+offset.
    const drawn = { x: 1200 * WORKSPACE_VIEW_SCALE + view.offsetX, y: 300 * WORKSPACE_VIEW_SCALE + view.offsetY };
    const back = workspaceToEditorCoords(drawn.x, drawn.y, view);
    expect(back.x).toBeCloseTo(1200, 6);
    expect(back.y).toBeCloseTo(300, 6);
  });

  test('snapMovedScreenTransform snaps placement edges and center to the frame', () => {
    // 16:9 source at half scale → placement is 960x540. Center at (486, 540):
    // left edge sits at 6px, within the threshold → snaps to 0 with a guide.
    const nearLeft = snapMovedScreenTransform({ x: 486, y: 540, scale: 0.5 }, 3840, 2160);
    expect(nearLeft.transform.x).toBeCloseTo(480, 6);
    expect(nearLeft.guideX).toBe(0);
    // y is exactly on the horizontal center line → center snap engages.
    expect(nearLeft.guideY).toBe(540);

    // Right edge near the frame's right edge snaps to 1920.
    const nearRight = snapMovedScreenTransform({ x: 1430, y: 300, scale: 0.5 }, 3840, 2160);
    expect(nearRight.transform.x).toBeCloseTo(1440, 6);
    expect(nearRight.guideX).toBe(1920);

    // Far from everything: unchanged, no guides.
    const free = snapMovedScreenTransform({ x: 700, y: 300, scale: 0.5 }, 3840, 2160);
    expect(free.transform).toEqual({ x: 700, y: 300, scale: 0.5 });
    expect(free.guideX).toBeNull();
    expect(free.guideY).toBeNull();
  });

  test('snapMovedScreenTransform picks the nearest snap candidate per axis', () => {
    // Center x at 955 is 5px from the center line and 475px from edges.
    const snapped = snapMovedScreenTransform({ x: 955, y: 300, scale: 0.5 }, 3840, 2160);
    expect(snapped.transform.x).toBeCloseTo(960, 6);
    expect(snapped.guideX).toBe(960);
  });

  test('snapResizeCursor pulls the dragged corner onto frame edges', () => {
    const snapped = snapResizeCursor(1920 - SCREEN_SNAP_THRESHOLD / 2, 500);
    expect(snapped.x).toBe(1920);
    expect(snapped.guideX).toBe(1920);
    expect(snapped.y).toBe(500);
    expect(snapped.guideY).toBeNull();

    const free = snapResizeCursor(700, 300);
    expect(free).toEqual({ x: 700, y: 300, guideX: null, guideY: null });
  });

  test('cursorForScreenHit maps hits to CSS cursors', () => {
    expect(cursorForScreenHit({ kind: 'body' })).toBe('move');
    expect(cursorForScreenHit({ kind: 'handle', corner: 'nw' })).toBe('nwse-resize');
    expect(cursorForScreenHit({ kind: 'handle', corner: 'ne' })).toBe('nesw-resize');
    expect(cursorForScreenHit(null)).toBe('');
  });
});
