import { describe, expect, test } from 'vitest';

import {
  chooseRenderFps,
  parseHasAudioFromProbeOutput,
  parseFpsToken,
  parseVideoFpsFromProbeOutput
} from '../../src/main/services/fps-service';

describe('main/services/fps-service', () => {
  test('parseFpsToken parses numeric and ratio tokens', () => {
    expect(parseFpsToken('30')).toBe(30);
    expect(parseFpsToken('30000/1001')).toBeCloseTo(29.97, 2);
    expect(parseFpsToken('')).toBeNull();
    expect(parseFpsToken('abc')).toBeNull();
  });

  test('parseVideoFpsFromProbeOutput extracts fps from ffmpeg output', () => {
    const output = 'Stream #0:0: Video: h264, yuv420p, 1920x1080, 30000/1001 fps, 30000/1001 tbr';
    expect(parseVideoFpsFromProbeOutput(output)).toBeCloseTo(29.97, 2);
  });

  test('chooseRenderFps caps camera renders at 30 fps', () => {
    expect(chooseRenderFps([59.9, 60], false)).toBe(60);
    expect(chooseRenderFps([60], true)).toBe(30);
    expect(chooseRenderFps([], false)).toBe(30);
  });

  test('parseHasAudioFromProbeOutput detects audio streams', () => {
    const withAudio =
      'Stream #0:0(eng): Video: vp8, yuv420p, 1920x1080\n' +
      'Stream #0:1(eng): Audio: opus, 48000 Hz, mono, fltp';
    expect(parseHasAudioFromProbeOutput(withAudio)).toBe(true);

    const videoOnly = 'Stream #0:0(eng): Video: vp8, yuv420p, 5120x2880, 1k tbr';
    expect(parseHasAudioFromProbeOutput(videoOnly)).toBe(false);

    expect(parseHasAudioFromProbeOutput(null)).toBe(false);
    expect(parseHasAudioFromProbeOutput('')).toBe(false);
  });
});
