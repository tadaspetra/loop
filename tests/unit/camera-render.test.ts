import { describe, expect, test } from 'vitest';

import {
  drawMirroredImage,
  getCenteredSquareCropRect
} from '../../src/renderer/features/camera/camera-render';

describe('renderer/features/camera/camera-render', () => {
  test('getCenteredSquareCropRect centers the square crop', () => {
    expect(getCenteredSquareCropRect(1280, 720)).toEqual({
      sourceX: 280,
      sourceY: 0,
      size: 720
    });
    expect(getCenteredSquareCropRect(720, 1280)).toEqual({
      sourceX: 0,
      sourceY: 280,
      size: 720
    });
    expect(getCenteredSquareCropRect(0, 720)).toBeNull();
  });

  test('drawMirroredImage flips the destination rect horizontally', () => {
    const calls: Array<{ name: string; args: unknown[] }> = [];
    const targetCtx = {
      save: () => calls.push({ name: 'save', args: [] }),
      translate: (...args: unknown[]) => calls.push({ name: 'translate', args }),
      scale: (...args: unknown[]) => calls.push({ name: 'scale', args }),
      drawImage: (...args: unknown[]) => calls.push({ name: 'drawImage', args }),
      restore: () => calls.push({ name: 'restore', args: [] })
    } as unknown as Pick<
      CanvasRenderingContext2D,
      'drawImage' | 'restore' | 'save' | 'scale' | 'translate'
    >;
    const source = { id: 'camera' } as unknown as CanvasImageSource;

    drawMirroredImage(targetCtx, source, 10, 20, 300, 200, 100, 150, 320, 180);

    expect(calls).toEqual([
      { name: 'save', args: [] },
      { name: 'translate', args: [420, 150] },
      { name: 'scale', args: [-1, 1] },
      { name: 'drawImage', args: [source, 10, 20, 300, 200, 0, 0, 320, 180] },
      { name: 'restore', args: [] }
    ]);
  });
});
