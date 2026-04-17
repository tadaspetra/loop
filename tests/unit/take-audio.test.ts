import { describe, expect, test } from 'vitest';

import { resolveTakeAudio } from '../../src/shared/domain/take-audio';

describe('shared/domain/take-audio', () => {
  test('routes audio to the camera file when audioSource is camera', () => {
    const take = {
      screenPath: '/proj/screen.webm',
      cameraPath: '/proj/camera.webm',
      audioPath: null,
      audioSource: 'camera' as const
    };
    expect(resolveTakeAudio(take)).toEqual({
      path: '/proj/camera.webm',
      source: 'camera'
    });
  });

  test('routes audio to the dedicated audio file when audioSource is external', () => {
    const take = {
      screenPath: '/proj/screen.webm',
      cameraPath: null,
      audioPath: '/proj/audio.webm',
      audioSource: 'external' as const
    };
    expect(resolveTakeAudio(take)).toEqual({
      path: '/proj/audio.webm',
      source: 'external'
    });
  });

  test('defaults legacy takes to the screen file when audioSource is screen', () => {
    const take = {
      screenPath: '/proj/screen.webm',
      cameraPath: '/proj/camera.webm',
      audioPath: null,
      audioSource: 'screen' as const
    };
    // Legacy takes predate the routing change: the mic was always muxed into
    // the screen webm and must keep resolving there so existing projects
    // continue to play and export correctly.
    expect(resolveTakeAudio(take)).toEqual({
      path: '/proj/screen.webm',
      source: 'screen'
    });
  });

  test('returns no audio when audioSource is null or the referenced file is missing', () => {
    expect(
      resolveTakeAudio({
        screenPath: '/proj/screen.webm',
        cameraPath: null,
        audioPath: null,
        audioSource: null
      })
    ).toEqual({ path: null, source: null });

    // audioSource says "external" but no audioPath was saved -> no audio.
    expect(
      resolveTakeAudio({
        screenPath: '/proj/screen.webm',
        cameraPath: null,
        audioPath: null,
        audioSource: 'external'
      })
    ).toEqual({ path: null, source: null });

    // audioSource says "camera" but no camera file was saved -> no audio.
    expect(
      resolveTakeAudio({
        screenPath: '/proj/screen.webm',
        cameraPath: null,
        audioPath: null,
        audioSource: 'camera'
      })
    ).toEqual({ path: null, source: null });
  });

  test('is defensive against null / undefined takes', () => {
    expect(resolveTakeAudio(null)).toEqual({ path: null, source: null });
    expect(resolveTakeAudio(undefined)).toEqual({ path: null, source: null });
  });
});
