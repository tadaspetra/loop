import { describe, expect, test } from 'vitest';

import { getTakePlaybackSources } from '../../src/renderer/features/timeline/take-playback-sources';

describe('renderer/features/timeline/take-playback-sources', () => {
  test('prefers the screen proxy when the take has no camera video', () => {
    expect(
      getTakePlaybackSources({
        screenPath: '/project/screen.webm',
        cameraPath: null,
        proxyPath: '/project/screen-proxy.mp4'
      })
    ).toEqual({
      screenPath: '/project/screen-proxy.mp4',
      cameraPath: null
    });
  });

  test('avoids mixing a screen proxy with raw camera playback', () => {
    expect(
      getTakePlaybackSources({
        screenPath: '/project/screen.webm',
        cameraPath: '/project/camera.webm',
        proxyPath: '/project/screen-proxy.mp4'
      })
    ).toEqual({
      screenPath: '/project/screen.webm',
      cameraPath: '/project/camera.webm'
    });
  });

  test('returns null paths when take data is missing', () => {
    expect(getTakePlaybackSources(null)).toEqual({
      screenPath: null,
      cameraPath: null
    });
  });
});
