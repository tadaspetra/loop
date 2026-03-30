export interface CenteredSquareCropRect {
  sourceX: number;
  sourceY: number;
  size: number;
}

type MirrorDrawContext = Pick<
  CanvasRenderingContext2D,
  'drawImage' | 'restore' | 'save' | 'scale' | 'translate'
>;

export function getCenteredSquareCropRect(
  sourceWidth: number,
  sourceHeight: number
): CenteredSquareCropRect | null {
  if (
    !Number.isFinite(sourceWidth) ||
    !Number.isFinite(sourceHeight) ||
    sourceWidth <= 0 ||
    sourceHeight <= 0
  ) {
    return null;
  }

  const size = Math.min(sourceWidth, sourceHeight);
  return {
    sourceX: (sourceWidth - size) / 2,
    sourceY: (sourceHeight - size) / 2,
    size
  };
}

export function drawMirroredImage(
  targetCtx: MirrorDrawContext,
  source: CanvasImageSource,
  sourceX: number,
  sourceY: number,
  sourceWidth: number,
  sourceHeight: number,
  destX: number,
  destY: number,
  destWidth: number,
  destHeight: number
): void {
  targetCtx.save();
  targetCtx.translate(destX + destWidth, destY);
  targetCtx.scale(-1, 1);
  targetCtx.drawImage(
    source,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    0,
    0,
    destWidth,
    destHeight
  );
  targetCtx.restore();
}
