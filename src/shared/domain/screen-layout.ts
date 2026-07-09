// Free placement ("OBS-style") of the screen recording inside the fixed 16:9
// authoring canvas. The transform is authored in 1920×1080 space like PiP and
// overlay geometry; render targets with other (16:9) resolutions scale it
// proportionally.

export const AUTHORING_CANVAS_W = 1920;
export const AUTHORING_CANVAS_H = 1080;

export const MIN_SCREEN_TRANSFORM_SCALE = 0.1;
export const MAX_SCREEN_TRANSFORM_SCALE = 4;

export interface ScreenTransform {
  // Center of the drawn screen rect in 1920×1080 authoring space. Clamped to
  // the canvas so the recording can never be dragged fully offscreen.
  x: number;
  y: number;
  // Multiplier relative to the aspect-fit size (scale=1 → the whole recording
  // exactly fits inside the canvas).
  scale: number;
}

export interface ScreenPlacement {
  left: number;
  top: number;
  width: number;
  height: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function normalizeScreenTransform(value: unknown): ScreenTransform | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  const x = Number(record.x);
  const y = Number(record.y);
  const scale = Number(record.scale);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(scale) || scale <= 0) {
    return null;
  }
  return {
    x: clamp(x, 0, AUTHORING_CANVAS_W),
    y: clamp(y, 0, AUTHORING_CANVAS_H),
    scale: clamp(scale, MIN_SCREEN_TRANSFORM_SCALE, MAX_SCREEN_TRANSFORM_SCALE)
  };
}

/**
 * Where the screen recording lands on the canvas, in canvas pixels. With a
 * transform the placement preserves the source aspect ratio at
 * `fit-size × transform.scale`, centered on the transform's (x, y). Without a
 * transform it reproduces the legacy screenFitMode behavior: 'fill' covers the
 * canvas (cropping overflow), 'fit' letterboxes inside it.
 */
export function computeScreenPlacement(
  sourceW: number,
  sourceH: number,
  canvasW: number,
  canvasH: number,
  fitMode: 'fill' | 'fit',
  transform: ScreenTransform | null
): ScreenPlacement | null {
  if (
    !Number.isFinite(sourceW) ||
    !Number.isFinite(sourceH) ||
    !Number.isFinite(canvasW) ||
    !Number.isFinite(canvasH) ||
    sourceW <= 0 ||
    sourceH <= 0 ||
    canvasW <= 0 ||
    canvasH <= 0
  ) {
    return null;
  }

  const fitScale = Math.min(canvasW / sourceW, canvasH / sourceH);

  if (transform) {
    const scale = fitScale * transform.scale;
    const width = sourceW * scale;
    const height = sourceH * scale;
    // The transform is authored in 1920×1080 space; map its center onto the
    // actual canvas. All render canvases are 16:9, so a single ratio suffices
    // (min() guards against a hypothetical non-16:9 canvas).
    const authoringScale = Math.min(canvasW / AUTHORING_CANVAS_W, canvasH / AUTHORING_CANVAS_H);
    const centerX = transform.x * authoringScale;
    const centerY = transform.y * authoringScale;
    return {
      left: centerX - width / 2,
      top: centerY - height / 2,
      width,
      height
    };
  }

  const scale =
    fitMode === 'fill' ? Math.max(canvasW / sourceW, canvasH / sourceH) : fitScale;
  const width = sourceW * scale;
  const height = sourceH * scale;
  return {
    left: (canvasW - width) / 2,
    top: (canvasH - height) / 2,
    width,
    height
  };
}

/**
 * Transform equivalent to the legacy fitMode placement — used to seed a
 * draggable transform the first time the user grabs the screen layer.
 */
export function defaultScreenTransform(
  fitMode: 'fill' | 'fit',
  sourceW: number,
  sourceH: number
): ScreenTransform {
  let scale = 1;
  if (fitMode === 'fill' && sourceW > 0 && sourceH > 0) {
    const fit = Math.min(AUTHORING_CANVAS_W / sourceW, AUTHORING_CANVAS_H / sourceH);
    const cover = Math.max(AUTHORING_CANVAS_W / sourceW, AUTHORING_CANVAS_H / sourceH);
    scale = fit > 0 ? cover / fit : 1;
  }
  return {
    x: AUTHORING_CANVAS_W / 2,
    y: AUTHORING_CANVAS_H / 2,
    scale: clamp(scale, MIN_SCREEN_TRANSFORM_SCALE, MAX_SCREEN_TRANSFORM_SCALE)
  };
}
