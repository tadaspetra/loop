import { describe, expect, test } from 'vitest';

import {
  buildAlphaExpr,
  buildCamFullAlphaExpr,
  buildFilterComplex,
  buildNumericExpr,
  buildPosExpr,
  panToFocusCoord
} from '../../src/main/services/render-filter-service';
import type { Keyframe } from '../../src/shared/domain/project';

describe('main/services/render-filter-service', () => {
  test('buildPosExpr transitions before the keyframe time (end of previous section)', () => {
    const expr = buildPosExpr(
      [
        { time: 0, pipX: 100, cameraFullscreen: false },
        { time: 1, pipX: 200, cameraFullscreen: false }
      ] as Keyframe[],
      'pipX'
    );
    // Transition starts at 0.7 (kf.time - 0.3) and ends at 1.0 (kf.time)
    expect(expr).toContain('if(gte(t,1.000)');
    expect(expr).toContain('if(gte(t,0.700)');
    expect(expr).toContain('200');
    expect(expr).toContain('pow(');
  });

  test('buildAlphaExpr transitions before the keyframe time', () => {
    const expr = buildAlphaExpr([
      { time: 0, pipVisible: true },
      { time: 2, pipVisible: false }
    ] as Keyframe[]);
    // At T=2.0 fully invisible, transition starts at T=1.7
    expect(expr).toContain('if(gte(T,2.000),0');
    expect(expr).toContain('if(gte(T,1.700)');
    expect(expr).toContain('pow(');
  });

  test('buildCamFullAlphaExpr transitions before the keyframe time', () => {
    const expr = buildCamFullAlphaExpr([
      { time: 0, pipVisible: true, cameraFullscreen: false },
      { time: 1, pipVisible: true, cameraFullscreen: true }
    ] as Keyframe[]);
    // At T=1.0 fully visible fullscreen, transition starts at T=0.7
    expect(expr).toContain('if(gte(T,1.000),1');
    expect(expr).toContain('if(gte(T,0.700)');
    expect(expr).toContain('pow(');
  });

  test('buildPosExpr snaps position at transition start for fullscreen→pip', () => {
    const expr = buildPosExpr(
      [
        { time: 0, pipX: 100, cameraFullscreen: true, pipVisible: true },
        { time: 2, pipX: 200, cameraFullscreen: false, pipVisible: true }
      ] as Keyframe[],
      'pipX'
    );
    // Position should snap to destination at tStart (1.700), not at t (2.000)
    expect(expr).toContain('if(gte(t,1.700),200');
  });

  test('buildPosExpr snaps position at transition start for hidden→visible', () => {
    const expr = buildPosExpr(
      [
        { time: 0, pipX: 100, cameraFullscreen: false, pipVisible: false },
        { time: 2, pipX: 200, cameraFullscreen: false, pipVisible: true }
      ] as Keyframe[],
      'pipX'
    );
    // Position should snap to destination at tStart (1.700), not at t (2.000)
    expect(expr).toContain('if(gte(t,1.700),200');
  });

  test('buildNumericExpr transitions before the next section time', () => {
    const expr = buildNumericExpr(
      [
        { time: 0, backgroundZoom: 1 },
        { time: 2, backgroundZoom: 2 }
      ] as Keyframe[],
      'backgroundZoom',
      3,
      0,
      'it'
    );
    expect(expr).toContain('if(gte(it,2.000),2.000');
    expect(expr).toContain('if(gte(it,1.700),1.000+1.000*');
    expect(expr).toContain('pow(');
  });

  test('panToFocusCoord converts section pan into focus position', () => {
    expect(panToFocusCoord(1, 1)).toBe(0.5);
    expect(panToFocusCoord(2, 1)).toBe(0.75);
    expect(panToFocusCoord(2, -1)).toBe(0.25);
  });

  test('buildFilterComplex returns overlay pipeline string', () => {
    const filter = buildFilterComplex(
      [
        {
          time: 0,
          pipX: 100,
          pipY: 100,
          pipVisible: true,
          cameraFullscreen: false,
          backgroundZoom: 1,
          backgroundPanX: 0,
          backgroundPanY: 0
        },
        {
          time: 2,
          pipX: 120,
          pipY: 120,
          pipVisible: true,
          cameraFullscreen: false,
          backgroundZoom: 2,
          backgroundPanX: 1,
          backgroundPanY: -1
        }
      ] as Keyframe[],
      320,
      'fill',
      1920,
      1080,
      1920,
      1080
    );
    expect(filter).toContain('[screen]');
    expect(filter).toContain('[cam]');
    expect(filter).toContain('overlay');
    expect(filter).toContain('[1:v]setpts=PTS-STARTPTS,hflip,crop=');
    expect(filter).toContain("zoompan=z='if(gte(it,2.000),2.000");
    expect(filter).toContain(":x='max(0,min(iw-iw/zoom,iw*(if(gte(it,2.000),0.750000");
  });

  test('buildFilterComplex mirrors the shared camera source before fullscreen transitions', () => {
    const filter = buildFilterComplex(
      [
        {
          time: 0,
          pipX: 100,
          pipY: 100,
          pipVisible: true,
          cameraFullscreen: false,
          backgroundZoom: 1,
          backgroundPanX: 0,
          backgroundPanY: 0
        },
        {
          time: 2,
          pipX: 120,
          pipY: 120,
          pipVisible: true,
          cameraFullscreen: true,
          backgroundZoom: 1,
          backgroundPanX: 0,
          backgroundPanY: 0
        }
      ] as Keyframe[],
      320,
      'fill',
      1920,
      1080,
      1920,
      1080
    );

    expect(filter).toContain('[1:v]setpts=PTS-STARTPTS,hflip,split[cam1][cam2]');
    expect(filter).toContain('[with_pip][camfull]overlay=0:0:format=auto[out]');
  });

  test('buildFilterComplex scales screen into the editor canvas', () => {
    const filter = buildFilterComplex(
      [
        { time: 0, pipX: 100, pipY: 100, pipVisible: true, cameraFullscreen: false },
        { time: 2, pipX: 120, pipY: 120, pipVisible: true, cameraFullscreen: false }
      ] as Keyframe[],
      320,
      'fill',
      1920,
      1080,
      1920,
      1080
    );
    expect(filter).toContain(
      'scale=1920:1080:flags=lanczos:force_original_aspect_ratio=increase,crop=1920:1080[screen]'
    );
  });

  test('buildFilterComplex keeps PiP coordinates in editor canvas space', () => {
    const filter = buildFilterComplex(
      [
        {
          time: 0,
          pipX: 1478,
          pipY: 638,
          pipVisible: true,
          cameraFullscreen: false,
          backgroundZoom: 1,
          backgroundPanX: 0,
          backgroundPanY: 0
        }
      ] as Keyframe[],
      422,
      'fill',
      1510,
      982,
      1920,
      1080
    );

    expect(filter).toContain('scale=422:422');
    expect(filter).toContain("overlay=x='1478':y='638'");
    expect(filter).toContain(
      'scale=1920:1080:flags=lanczos:force_original_aspect_ratio=increase,crop=1920:1080'
    );
  });

  test('buildFilterComplex scales PiP size and position for 1440p export canvases', () => {
    const filter = buildFilterComplex(
      [
        {
          time: 0,
          pipX: 1478,
          pipY: 638,
          pipVisible: true,
          cameraFullscreen: false,
          backgroundZoom: 1,
          backgroundPanX: 0,
          backgroundPanY: 0
        }
      ] as Keyframe[],
      422,
      'fill',
      2560,
      1440,
      2560,
      1440
    );

    expect(filter).toContain('scale=562:562');
    expect(filter).toContain("overlay=x='1971':y='851'");
    expect(filter).toContain(
      'scale=2560:1440:flags=lanczos:force_original_aspect_ratio=increase,crop=2560:1440'
    );
  });

  test('buildAlphaExpr collapses redundant visibility anchors for long timelines', () => {
    const keyframes = Array.from({ length: 240 }, (_, index) => ({
      time: index * 15,
      pipVisible: true
    })) as Keyframe[];

    expect(buildAlphaExpr(keyframes)).toBe('1');
  });

  test('buildFilterComplex keeps camera overlay expressions compact with many redundant anchors', () => {
    const keyframes = Array.from({ length: 240 }, (_, index) => ({
      time: index * 15,
      pipX: 120,
      pipY: 180,
      pipVisible: true,
      cameraFullscreen: false,
      backgroundZoom: 1,
      backgroundPanX: 0,
      backgroundPanY: 0
    })) as Keyframe[];

    const filter = buildFilterComplex(keyframes, 320, 'fill', 1920, 1080, 1920, 1080);

    expect(filter).toContain("overlay=x='120':y='180'");
    expect(filter).not.toContain('if(gte(T,');
    expect(filter.length).toBeLessThan(2000);
  });
});
