import { describe, expect, test } from 'vitest';

import { getTakePlaybackSources } from '../../src/renderer/features/timeline/take-playback-sources';

describe('renderer/features/timeline/take-playback-sources', () => {
  test('prefers the screen proxy when the take has no camera video', () => {
    expect(
      getTakePlaybackSources({
        screenPath: '/project/screen.webm',
        cameraPath: null,
        proxyPath: '/project/screen-proxy.mp4',
        cameraProxyPath: null
      })
    ).toEqual({
      screenPath: '/project/screen-proxy.mp4',
      cameraPath: null
    });
  });

  test('prefers the screen proxy alongside a raw camera so editor decode load stays manageable', () => {
    // The v2 proxy preserves input PTS, so mixing it with the raw camera
    // WebM no longer drifts. Always using the proxy (even when a camera is
    // present) is the whole point — it keeps long-video playback from
    // saturating the software VP8 decoder and falling out of A/V sync.
    expect(
      getTakePlaybackSources({
        screenPath: '/project/screen.webm',
        cameraPath: '/project/camera.webm',
        proxyPath: '/project/screen-proxy-v2.mp4',
        cameraProxyPath: null
      })
    ).toEqual({
      screenPath: '/project/screen-proxy-v2.mp4',
      cameraPath: '/project/camera.webm'
    });
  });

  test('falls back to the raw screen path when no proxy has been generated yet', () => {
    // Freshly recorded takes show up before the background proxy render
    // finishes; in that window we must still play the raw file.
    expect(
      getTakePlaybackSources({
        screenPath: '/project/screen.webm',
        cameraPath: '/project/camera.webm',
        proxyPath: null,
        cameraProxyPath: null
      })
    ).toEqual({
      screenPath: '/project/screen.webm',
      cameraPath: '/project/camera.webm'
    });
  });

  test('prefers the camera proxy when available so dual-decoder load stays minimal', () => {
    expect(
      getTakePlaybackSources({
        screenPath: '/project/screen.webm',
        cameraPath: '/project/camera.webm',
        proxyPath: '/project/screen-proxy-v2.mp4',
        cameraProxyPath: '/project/camera-proxy-v2.mp4'
      })
    ).toEqual({
      screenPath: '/project/screen-proxy-v2.mp4',
      cameraPath: '/project/camera-proxy-v2.mp4'
    });
  });

  test('falls back to the raw camera when its proxy has not been generated yet', () => {
    expect(
      getTakePlaybackSources({
        screenPath: '/project/screen.webm',
        cameraPath: '/project/camera.webm',
        proxyPath: '/project/screen-proxy-v2.mp4',
        cameraProxyPath: null
      })
    ).toEqual({
      screenPath: '/project/screen-proxy-v2.mp4',
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
