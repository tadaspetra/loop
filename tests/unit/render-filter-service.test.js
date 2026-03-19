const {
  buildPosExpr,
  buildNumericExpr,
  buildAlphaExpr,
  buildCamFullAlphaExpr,
  buildFilterComplex,
  buildScreenFilter,
  resolveOutputSize,
  panToFocusCoord
} = require('../../src/main/services/render-filter-service');

describe('main/services/render-filter-service', () => {
  test('buildPosExpr transitions before the keyframe time (end of previous section)', () => {
    const expr = buildPosExpr(
      [
        { time: 0, pipX: 100, cameraFullscreen: false },
        { time: 1, pipX: 200, cameraFullscreen: false }
      ],
      'pipX'
    );
    // Transition starts at 0.7 (kf.time - 0.3) and ends at 1.0 (kf.time)
    expect(expr).toContain('if(gte(t,1.000)');
    expect(expr).toContain('if(gte(t,0.700)');
    expect(expr).toContain('200');
  });

  test('buildAlphaExpr transitions before the keyframe time', () => {
    const expr = buildAlphaExpr([
      { time: 0, pipVisible: true },
      { time: 2, pipVisible: false }
    ]);
    // At T=2.0 fully invisible, transition starts at T=1.7
    expect(expr).toContain('if(gte(T,2.000),0');
    expect(expr).toContain('if(gte(T,1.700)');
  });

  test('buildCamFullAlphaExpr transitions before the keyframe time', () => {
    const expr = buildCamFullAlphaExpr([
      { time: 0, pipVisible: true, cameraFullscreen: false },
      { time: 1, pipVisible: true, cameraFullscreen: true }
    ]);
    // At T=1.0 fully visible fullscreen, transition starts at T=0.7
    expect(expr).toContain('if(gte(T,1.000),1');
    expect(expr).toContain('if(gte(T,0.700)');
  });

  test('buildPosExpr snaps position at transition start for fullscreen→pip', () => {
    const expr = buildPosExpr(
      [
        { time: 0, pipX: 100, cameraFullscreen: true, pipVisible: true },
        { time: 2, pipX: 200, cameraFullscreen: false, pipVisible: true }
      ],
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
      ],
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
      ],
      'backgroundZoom',
      3,
      0,
      'it'
    );
    expect(expr).toContain('if(gte(it,2.000),2.000');
    expect(expr).toContain('if(gte(it,1.700),1.000+1.000*(it-1.700)/0.300');
  });

  test('panToFocusCoord converts section pan into focus position', () => {
    expect(panToFocusCoord(1, 1)).toBe(0.5);
    expect(panToFocusCoord(2, 1)).toBe(0.75);
    expect(panToFocusCoord(2, -1)).toBe(0.25);
  });

  test('buildFilterComplex returns overlay pipeline string', () => {
    const filter = buildFilterComplex(
      [
        { time: 0, pipX: 100, pipY: 100, pipVisible: true, cameraFullscreen: false, backgroundZoom: 1, backgroundPanX: 0, backgroundPanY: 0 },
        { time: 2, pipX: 120, pipY: 120, pipVisible: true, cameraFullscreen: false, backgroundZoom: 2, backgroundPanX: 1, backgroundPanY: -1 }
      ],
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
    expect(filter).toContain("zoompan=z='if(gte(it,2.000),2.000");
    expect(filter).toContain(":x='max(0,min(iw-iw/zoom,iw*(if(gte(it,2.000),0.750000");
  });

  test('buildFilterComplex can skip screen scaling when preprocessed', () => {
    const filter = buildFilterComplex(
      [
        { time: 0, pipX: 100, pipY: 100, pipVisible: true, cameraFullscreen: false },
        { time: 2, pipX: 120, pipY: 120, pipVisible: true, cameraFullscreen: false }
      ],
      320,
      'fill',
      1920,
      1080,
      1920,
      1080,
      true
    );
    expect(filter).toContain('[0:v]setpts=PTS-STARTPTS[screen]');
  });

  test('resolveOutputSize returns 9:16 dimensions for reel mode', () => {
    const reel1080 = resolveOutputSize(1920, 1080, 'reel');
    expect(reel1080.outW).toBe(608);
    expect(reel1080.outH).toBe(1080);

    const reel1440 = resolveOutputSize(2560, 1440, 'reel');
    expect(reel1440.outW).toBe(810);
    expect(reel1440.outH).toBe(1440);
  });

  test('resolveOutputSize returns landscape dimensions by default', () => {
    const landscape = resolveOutputSize(1920, 1080);
    expect(landscape.outW).toBe(1920);
    expect(landscape.outH).toBe(1080);

    const landscapeExplicit = resolveOutputSize(1920, 1080, 'landscape');
    expect(landscapeExplicit.outW).toBe(1920);
    expect(landscapeExplicit.outH).toBe(1080);
  });

  test('buildScreenFilter with reel mode includes crop filter for static reelCropX', () => {
    const filter = buildScreenFilter(
      [{ time: 0, backgroundZoom: 1, backgroundPanX: 0, backgroundPanY: 0, reelCropX: 0 }],
      'fill',
      1920,
      1080,
      1920,
      1080,
      '[screen]',
      true,
      30,
      'reel'
    );
    expect(filter).toContain('crop=608:1080:');
    expect(filter).toContain('[screen]');
  });

  test('buildScreenFilter with reel mode and animated reelCropX includes interpolation', () => {
    const filter = buildScreenFilter(
      [
        { time: 0, backgroundZoom: 1, backgroundPanX: 0, backgroundPanY: 0, reelCropX: -0.5 },
        { time: 2, backgroundZoom: 1, backgroundPanX: 0, backgroundPanY: 0, reelCropX: 0.5 }
      ],
      'fill',
      1920,
      1080,
      1920,
      1080,
      '[screen]',
      true,
      30,
      'reel'
    );
    expect(filter).toContain('crop=608:1080:');
    expect(filter).toContain('if(gte(t,2.000)');
  });

  test('buildScreenFilter with reel mode and static zoom < 1 produces split/overlay filter', () => {
    const filter = buildScreenFilter(
      [{ time: 0, backgroundZoom: 0.7, backgroundPanX: 0, backgroundPanY: 0, reelCropX: 0 }],
      'fill',
      1920,
      1080,
      1920,
      1080,
      '[screen]',
      false,
      30,
      'reel'
    );
    expect(filter).toContain('split[for_zoom][for_bg]');
    expect(filter).toContain('colorlevels=romax=0.2:gomax=0.2:bomax=0.2');
    expect(filter).toContain('[dark_bg]');
    expect(filter).toContain('crop=608:1080:');
    expect(filter).toContain('[screen]');
    // Should scale content uniformly to 70% of both dimensions
    let scaledW = Math.round(1920 * 0.7);
    if (scaledW % 2 !== 0) scaledW -= 1;
    let scaledH = Math.round(1080 * 0.7);
    if (scaledH % 2 !== 0) scaledH -= 1;
    const offsetX = Math.round((1920 - scaledW) / 2);
    const offsetY = Math.round((1080 - scaledH) / 2);
    expect(filter).toContain(`scale=${scaledW}:${scaledH}`);
    expect(filter).toContain(`overlay=${offsetX}:${offsetY}`);
  });

  test('buildScreenFilter with reel mode and animated zoom crossing 1.0 produces zoompan + scale pipeline', () => {
    const filter = buildScreenFilter(
      [
        { time: 0, backgroundZoom: 0.7, backgroundPanX: 0, backgroundPanY: 0, reelCropX: 0 },
        { time: 2, backgroundZoom: 1.5, backgroundPanX: 0.5, backgroundPanY: 0, reelCropX: 0 }
      ],
      'fill',
      1920,
      1080,
      1920,
      1080,
      '[screen]',
      false,
      30,
      'reel'
    );
    expect(filter).toContain('split[for_zoom][for_bg]');
    expect(filter).toContain('colorlevels=romax=0.2:gomax=0.2:bomax=0.2');
    expect(filter).toContain("zoompan=z='max(1.000,");
    expect(filter).toContain('[zoomed]');
    expect(filter).toContain(`scale=w='max(2,2*floor(1920*min(1.0,`);
    expect(filter).toContain(`h='max(2,2*floor(1080*min(1.0,`);
    expect(filter).toContain(':eval=frame');
    expect(filter).toContain('[scaled]');
    expect(filter).toContain("overlay=x='(main_w-overlay_w)/2':y='(main_h-overlay_h)/2':eval=frame");
    expect(filter).toContain('crop=608:1080:');
    expect(filter).toContain('[screen]');
  });

  test('buildScreenFilter with reel mode and zoom >= 1 remains unchanged', () => {
    const filter = buildScreenFilter(
      [
        { time: 0, backgroundZoom: 1.5, backgroundPanX: 0, backgroundPanY: 0, reelCropX: 0 },
        { time: 2, backgroundZoom: 2.0, backgroundPanX: 0.5, backgroundPanY: 0, reelCropX: 0 }
      ],
      'fill',
      1920,
      1080,
      1920,
      1080,
      '[screen]',
      false,
      30,
      'reel'
    );
    // Should NOT use the split/overlay pipeline
    expect(filter).not.toContain('split[for_zoom][for_bg]');
    expect(filter).not.toContain('colorlevels');
    // Should use standard zoompan
    expect(filter).toContain("zoompan=z='");
    expect(filter).toContain('crop=608:1080:');
  });

  test('resolveOutputSize behavior unchanged for zoom-out feature', () => {
    // Landscape unchanged
    expect(resolveOutputSize(1920, 1080).outW).toBe(1920);
    expect(resolveOutputSize(1920, 1080).outH).toBe(1080);
    // Reel unchanged
    expect(resolveOutputSize(1920, 1080, 'reel').outW).toBe(608);
    expect(resolveOutputSize(1920, 1080, 'reel').outH).toBe(1080);
  });

  test('buildFilterComplex with reel mode uses reel output dimensions', () => {
    const filter = buildFilterComplex(
      [
        { time: 0, pipX: 100, pipY: 100, pipVisible: true, cameraFullscreen: false, backgroundZoom: 1, backgroundPanX: 0, backgroundPanY: 0, reelCropX: 0, pipScale: 0.33 }
      ],
      200,
      'fill',
      1920,
      1080,
      608,
      1080,
      true,
      30,
      'reel'
    );
    // pipScale 0.33 * outW 608 = 200.64 → 201 (static)
    expect(filter).toContain('crop=608:1080:');
    expect(filter).toContain('scale=201:201');
    expect(filter).toContain('overlay');
  });

  test('buildFilterComplex with static pipScale uses fixed PIP size', () => {
    const filter = buildFilterComplex(
      [
        { time: 0, pipX: 100, pipY: 100, pipVisible: true, cameraFullscreen: false, backgroundZoom: 1, pipScale: 0.22 },
        { time: 2, pipX: 120, pipY: 120, pipVisible: true, cameraFullscreen: false, backgroundZoom: 1, pipScale: 0.22 }
      ],
      422,
      'fill',
      1920,
      1080,
      1920,
      1080
    );
    // Static pipScale 0.22 * outW 1920 = 422
    expect(filter).toContain('scale=422:422');
    // Static case: only one scale step (no animated second scale)
    expect(filter).not.toContain('scale=w=');
  });

  test('buildFilterComplex with varying pipScale uses two-stage scale (fixed + animated)', () => {
    const filter = buildFilterComplex(
      [
        { time: 0, pipX: 100, pipY: 100, pipVisible: true, cameraFullscreen: false, backgroundZoom: 1, pipScale: 0.22 },
        { time: 2, pipX: 120, pipY: 120, pipVisible: true, cameraFullscreen: false, backgroundZoom: 1, pipScale: 0.40 }
      ],
      422,
      'fill',
      1920,
      1080,
      1920,
      1080
    );
    // First scale: fixed max pip size (0.40 * 1920 = 768)
    expect(filter).toContain('scale=768:768');
    // Second scale: animated with eval=frame
    expect(filter).toContain('eval=frame');
    expect(filter).toContain('0.220');
    expect(filter).toContain('0.400');
    // Overlay uses eval=frame for variable-size PIP
    expect(filter).toContain('overlay=x=');
    expect(filter).toContain(':eval=frame[out]');
  });

  test('buildFilterComplex defaults pipScale to 0.22 when not in keyframes', () => {
    const filter = buildFilterComplex(
      [
        { time: 0, pipX: 100, pipY: 100, pipVisible: true, cameraFullscreen: false, backgroundZoom: 1 }
      ],
      422,
      'fill',
      1920,
      1080,
      1920,
      1080
    );
    // Default pipScale 0.22 * outW 1920 = 422
    expect(filter).toContain('scale=422:422');
  });
});
