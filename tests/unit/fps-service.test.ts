import { describe, expect, test } from 'vitest';

import {
  chooseRenderFps,
  parseFpsToken,
  parseVideoDimensionsFromProbeOutput,
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

  test('parseVideoDimensionsFromProbeOutput extracts WxH from ffmpeg output', () => {
    const output = 'Stream #0:0: Video: h264 (High), yuv420p, 3840x2160 [SAR 1:1 DAR 16:9], 30 fps';
    expect(parseVideoDimensionsFromProbeOutput(output)).toEqual({ width: 3840, height: 2160 });
    expect(parseVideoDimensionsFromProbeOutput('garbage without dims')).toBeNull();
    expect(parseVideoDimensionsFromProbeOutput('')).toBeNull();
  });

  test('chooseRenderFps caps camera renders at 30 fps', () => {
    expect(chooseRenderFps([59.9, 60], false)).toBe(60);
    expect(chooseRenderFps([60], true)).toBe(30);
    expect(chooseRenderFps([], false)).toBe(30);
  });
});
