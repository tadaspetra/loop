// Pure hit-testing and drag math for the OBS-style screen layer transform in
// the editor preview. All coordinates are in the fixed 1920×1080 authoring
// canvas space that the editor canvas renders at.
import {
  AUTHORING_CANVAS_H,
  AUTHORING_CANVAS_W,
  computeScreenPlacement,
  normalizeScreenTransform,
  type ScreenPlacement,
  type ScreenTransform
} from '../../../shared/domain/screen-layout';

// Corner handle hit area, in canvas pixels. The editor canvas typically
// displays at roughly half size, so this reads as ~16-18px on screen.
export const SCREEN_HANDLE_HIT_SIZE = 36;

/**
 * Map a client (mouse) point onto the canvas bitmap's coordinate space. The
 * editor canvas renders with `object-contain`, so the 16:9 bitmap is
 * letterboxed inside the element box — mapping against the element rect alone
 * skews coordinates whenever the container is not exactly 16:9 (which made
 * drawn handles and their hit tests disagree near the frame corners).
 */
export function clientPointToCanvasCoords(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number },
  canvasW = AUTHORING_CANVAS_W,
  canvasH = AUTHORING_CANVAS_H
): { x: number; y: number } {
  if (rect.width <= 0 || rect.height <= 0 || canvasW <= 0 || canvasH <= 0) {
    return { x: 0, y: 0 };
  }
  const scale = Math.min(rect.width / canvasW, rect.height / canvasH);
  if (scale <= 0) return { x: 0, y: 0 };
  const contentLeft = rect.left + (rect.width - canvasW * scale) / 2;
  const contentTop = rect.top + (rect.height - canvasH * scale) / 2;
  return {
    x: (clientX - contentLeft) / scale,
    y: (clientY - contentTop) / scale
  };
}

export type ScreenCorner = 'nw' | 'ne' | 'sw' | 'se';

export type ScreenTransformHit = { kind: 'handle'; corner: ScreenCorner } | { kind: 'body' } | null;

interface CornerPoint {
  corner: ScreenCorner;
  x: number;
  y: number;
}

export function placementCorners(placement: ScreenPlacement): CornerPoint[] {
  return [
    { corner: 'nw', x: placement.left, y: placement.top },
    { corner: 'ne', x: placement.left + placement.width, y: placement.top },
    { corner: 'sw', x: placement.left, y: placement.top + placement.height },
    { corner: 'se', x: placement.left + placement.width, y: placement.top + placement.height }
  ];
}

function clampValue(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

// Handles are pulled inside the frame by this much so they stay visible and
// grabbable even when the placement's true corners sit at — or beyond — the
// canvas edge (e.g. Fill mode on a 16:10 capture overflows vertically).
export const HANDLE_EDGE_INSET = SCREEN_HANDLE_HIT_SIZE / 2;

/**
 * Where the corner handles are shown and grabbed. Clamped into the canvas by
 * default; pass clampToCanvas=false in the zoomed-out workspace view where
 * the true corners are visible.
 */
export function handleAnchorPoints(
  placement: ScreenPlacement,
  clampToCanvas = true
): CornerPoint[] {
  const points = placementCorners(placement);
  if (!clampToCanvas) return points;
  return points.map((point) => ({
    corner: point.corner,
    x: clampValue(point.x, HANDLE_EDGE_INSET, AUTHORING_CANVAS_W - HANDLE_EDGE_INSET),
    y: clampValue(point.y, HANDLE_EDGE_INSET, AUTHORING_CANVAS_H - HANDLE_EDGE_INSET)
  }));
}

export function hitTestScreenPlacement(
  x: number,
  y: number,
  placement: ScreenPlacement | null,
  handleSize = SCREEN_HANDLE_HIT_SIZE
): ScreenTransformHit {
  if (!placement) return null;
  const half = handleSize / 2;
  for (const point of handleAnchorPoints(placement)) {
    if (Math.abs(x - point.x) <= half && Math.abs(y - point.y) <= half) {
      return { kind: 'handle', corner: point.corner };
    }
  }
  if (
    x >= placement.left &&
    x <= placement.left + placement.width &&
    y >= placement.top &&
    y <= placement.top + placement.height
  ) {
    return { kind: 'body' };
  }
  return null;
}

export function moveScreenTransform(
  start: ScreenTransform,
  deltaX: number,
  deltaY: number
): ScreenTransform {
  return (
    normalizeScreenTransform({
      x: start.x + deltaX,
      y: start.y + deltaY,
      scale: start.scale
    }) ?? start
  );
}

export interface ResizeScreenTransformParams {
  corner: ScreenCorner;
  // The opposite corner of the placement at drag start; it stays fixed while
  // the dragged corner follows the cursor.
  anchorX: number;
  anchorY: number;
  cursorX: number;
  cursorY: number;
  sourceW: number;
  sourceH: number;
}

export function resizeScreenTransform(params: ResizeScreenTransformParams): ScreenTransform | null {
  const { corner, anchorX, anchorY, cursorX, cursorY, sourceW, sourceH } = params;
  if (sourceW <= 0 || sourceH <= 0) return null;
  const fit = Math.min(AUTHORING_CANVAS_W / sourceW, AUTHORING_CANVAS_H / sourceH);
  const fitW = sourceW * fit;
  const fitH = sourceH * fit;
  if (fitW <= 0 || fitH <= 0) return null;

  // Aspect-locked: whichever axis the cursor pulled further wins.
  const rawScale = Math.max(
    Math.abs(cursorX - anchorX) / fitW,
    Math.abs(cursorY - anchorY) / fitH
  );
  const normalized = normalizeScreenTransform({ x: anchorX, y: anchorY, scale: rawScale });
  if (!normalized) return null;
  const scale = normalized.scale;

  const dirX = corner === 'ne' || corner === 'se' ? 1 : -1;
  const dirY = corner === 'sw' || corner === 'se' ? 1 : -1;
  return (
    normalizeScreenTransform({
      x: anchorX + (dirX * (fitW * scale)) / 2,
      y: anchorY + (dirY * (fitH * scale)) / 2,
      scale
    }) ?? null
  );
}

export function oppositeCorner(placement: ScreenPlacement, corner: ScreenCorner): CornerPoint {
  const opposite: Record<ScreenCorner, ScreenCorner> = {
    nw: 'se',
    ne: 'sw',
    sw: 'ne',
    se: 'nw'
  };
  const target = opposite[corner];
  const point = placementCorners(placement).find((p) => p.corner === target);
  // placementCorners always contains all four corners.
  return point as CornerPoint;
}

export function cursorForScreenHit(hit: ScreenTransformHit): string {
  if (!hit) return '';
  if (hit.kind === 'body') return 'move';
  return hit.corner === 'nw' || hit.corner === 'se' ? 'nwse-resize' : 'nesw-resize';
}

// ===== Workspace view (zoomed-out canvas while dragging) =====

// While a screen-layer drag is active the editor renders the composition
// zoomed out to this fraction of the canvas, leaving a margin where content
// hanging outside the 16:9 frame stays visible as a dimmed ghost.
export const WORKSPACE_VIEW_SCALE = 0.8;

export interface WorkspaceView {
  scale: number;
  offsetX: number;
  offsetY: number;
}

export function getWorkspaceView(scale = WORKSPACE_VIEW_SCALE): WorkspaceView {
  return {
    scale,
    offsetX: (AUTHORING_CANVAS_W * (1 - scale)) / 2,
    offsetY: (AUTHORING_CANVAS_H * (1 - scale)) / 2
  };
}

/**
 * Map a point from raw canvas coordinates into editor (frame) coordinates
 * while the workspace view is active — the inverse of the draw transform
 * `p * scale + offset`.
 */
export function workspaceToEditorCoords(
  x: number,
  y: number,
  view: WorkspaceView = getWorkspaceView()
): { x: number; y: number } {
  return {
    x: (x - view.offsetX) / view.scale,
    y: (y - view.offsetY) / view.scale
  };
}

// ===== Snapping =====

// Snap distance in editor (1920×1080) pixels.
export const SCREEN_SNAP_THRESHOLD = 16;

export interface SnapGuides {
  // Editor-space positions of the vertical / horizontal guide line to draw
  // when a snap engaged, or null when the axis did not snap.
  guideX: number | null;
  guideY: number | null;
}

export interface SnappedTransform extends SnapGuides {
  transform: ScreenTransform;
}

interface SnapCandidate {
  delta: number;
  guide: number;
}

function bestSnap(candidates: SnapCandidate[], threshold: number): SnapCandidate | null {
  let best: SnapCandidate | null = null;
  for (const candidate of candidates) {
    if (Math.abs(candidate.delta) > threshold) continue;
    if (!best || Math.abs(candidate.delta) < Math.abs(best.delta)) best = candidate;
  }
  return best;
}

/**
 * Snap a moved transform so the placement's edges or center line up with the
 * frame edges and center lines. Returns the (possibly) adjusted transform and
 * the guide positions to draw for engaged snaps.
 */
export function snapMovedScreenTransform(
  transform: ScreenTransform,
  sourceW: number,
  sourceH: number,
  threshold = SCREEN_SNAP_THRESHOLD
): SnappedTransform {
  const placement = computeScreenPlacement(
    sourceW,
    sourceH,
    AUTHORING_CANVAS_W,
    AUTHORING_CANVAS_H,
    'fill',
    transform
  );
  if (!placement) return { transform, guideX: null, guideY: null };

  const right = placement.left + placement.width;
  const bottom = placement.top + placement.height;
  const snapX = bestSnap(
    [
      { delta: 0 - placement.left, guide: 0 },
      { delta: AUTHORING_CANVAS_W - right, guide: AUTHORING_CANVAS_W },
      { delta: AUTHORING_CANVAS_W / 2 - transform.x, guide: AUTHORING_CANVAS_W / 2 }
    ],
    threshold
  );
  const snapY = bestSnap(
    [
      { delta: 0 - placement.top, guide: 0 },
      { delta: AUTHORING_CANVAS_H - bottom, guide: AUTHORING_CANVAS_H },
      { delta: AUTHORING_CANVAS_H / 2 - transform.y, guide: AUTHORING_CANVAS_H / 2 }
    ],
    threshold
  );
  if (!snapX && !snapY) return { transform, guideX: null, guideY: null };

  const snapped =
    normalizeScreenTransform({
      x: transform.x + (snapX?.delta ?? 0),
      y: transform.y + (snapY?.delta ?? 0),
      scale: transform.scale
    }) ?? transform;
  return { transform: snapped, guideX: snapX?.guide ?? null, guideY: snapY?.guide ?? null };
}

/**
 * Snap the dragged corner's cursor position onto the frame edges / center
 * lines during a resize, so the corner lands exactly on the frame.
 */
export function snapResizeCursor(
  x: number,
  y: number,
  threshold = SCREEN_SNAP_THRESHOLD
): { x: number; y: number } & SnapGuides {
  const snapX = bestSnap(
    [
      { delta: 0 - x, guide: 0 },
      { delta: AUTHORING_CANVAS_W - x, guide: AUTHORING_CANVAS_W },
      { delta: AUTHORING_CANVAS_W / 2 - x, guide: AUTHORING_CANVAS_W / 2 }
    ],
    threshold
  );
  const snapY = bestSnap(
    [
      { delta: 0 - y, guide: 0 },
      { delta: AUTHORING_CANVAS_H - y, guide: AUTHORING_CANVAS_H },
      { delta: AUTHORING_CANVAS_H / 2 - y, guide: AUTHORING_CANVAS_H / 2 }
    ],
    threshold
  );
  return {
    x: x + (snapX?.delta ?? 0),
    y: y + (snapY?.delta ?? 0),
    guideX: snapX?.guide ?? null,
    guideY: snapY?.guide ?? null
  };
}
