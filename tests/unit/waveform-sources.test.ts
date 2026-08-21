import { describe, expect, test } from 'vitest';

import {
  getWaveformDecodeSources,
  resolveWaveformLoadStatus
} from '../../src/renderer/features/timeline/waveform-sources';

describe('renderer/features/timeline/waveform-sources', () => {
  test('tries the camera proxy then canonical camera audio', () => {
    expect(
      getWaveformDecodeSources({
        screenPath: '/project/screen.webm',
        cameraPath: '/project/camera.webm',
        audioPath: null,
        audioSource: 'camera',
        hasSystemAudio: false,
        proxyPath: '/project/screen-proxy-v2.mp4',
        cameraProxyPath: '/project/camera-proxy-v2.mp4'
      })
    ).toEqual({
      micCandidates: ['/project/camera-proxy-v2.mp4', '/project/camera.webm'],
      micSource: 'camera',
      systemCandidates: []
    });
  });

  test('tries the screen proxy then canonical screen audio', () => {
    expect(
      getWaveformDecodeSources({
        screenPath: '/project/screen.webm',
        cameraPath: null,
        audioPath: null,
        audioSource: 'screen',
        hasSystemAudio: true,
        proxyPath: '/project/screen-proxy-v2.mp4',
        cameraProxyPath: null
      })
    ).toEqual({
      micCandidates: ['/project/screen-proxy-v2.mp4', '/project/screen.webm'],
      micSource: 'screen',
      systemCandidates: []
    });
  });

  test('keeps external mic audio on its dedicated file while drawing system audio from screen playback', () => {
    expect(
      getWaveformDecodeSources({
        screenPath: '/project/screen.webm',
        cameraPath: null,
        audioPath: '/project/audio.webm',
        audioSource: 'external',
        hasSystemAudio: true,
        proxyPath: '/project/screen-proxy-v2.mp4',
        cameraProxyPath: null
      })
    ).toEqual({
      micCandidates: ['/project/audio.webm'],
      micSource: 'external',
      systemCandidates: ['/project/screen-proxy-v2.mp4', '/project/screen.webm']
    });
  });

  test('falls back to raw sources before proxies exist', () => {
    expect(
      getWaveformDecodeSources({
        screenPath: '/project/screen.webm',
        cameraPath: '/project/camera.webm',
        audioPath: null,
        audioSource: 'camera',
        hasSystemAudio: true,
        proxyPath: null,
        cameraProxyPath: null
      })
    ).toEqual({
      micCandidates: ['/project/camera.webm'],
      micSource: 'camera',
      systemCandidates: ['/project/screen.webm']
    });
  });

  test('distinguishes loading, no-audio, ready, and decode failure states', () => {
    expect(
      resolveWaveformLoadStatus({
        loading: true,
        candidateSourceCount: 2,
        decodedTrackCount: 0,
        failedTrackCount: 0
      })
    ).toBe('loading');
    expect(
      resolveWaveformLoadStatus({
        loading: false,
        candidateSourceCount: 0,
        decodedTrackCount: 0,
        failedTrackCount: 0
      })
    ).toBe('no-audio');
    expect(
      resolveWaveformLoadStatus({
        loading: false,
        candidateSourceCount: 2,
        decodedTrackCount: 1,
        failedTrackCount: 1
      })
    ).toBe('ready');
    expect(
      resolveWaveformLoadStatus({
        loading: false,
        candidateSourceCount: 2,
        decodedTrackCount: 0,
        failedTrackCount: 2
      })
    ).toBe('error');
  });
});
