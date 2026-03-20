const {
  buildPosExpr,
  buildNumericExpr,
  buildAlphaExpr,
  buildCamFullAlphaExpr,
  buildFilterComplex,
  buildScreenFilter,
  resolveOutputSize,
  panToFocusCoord,
  buildOverlayFilter
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

  test('buildFilterComplex applies fit-mode scale+pad when preprocessed in landscape', () => {
    // Non-16:9 source (1440x1080, 4:3) in fit mode
    // resolveOutputSize(1440,1080,'landscape') → 1440x810
    const filter = buildFilterComplex(
      [
        { time: 0, pipX: 100, pipY: 100, pipVisible: true, cameraFullscreen: false },
        { time: 2, pipX: 120, pipY: 120, pipVisible: true, cameraFullscreen: false }
      ],
      320,
      'fit',
      1440,
      1080,
      1920,
      1080,
      true
    );
    expect(filter).toContain('scale=1440:810');
    expect(filter).toContain('force_original_aspect_ratio=decrease');
    expect(filter).toContain('pad=1440:810:');
  });

  test('buildFilterComplex applies fill-mode scale+crop when preprocessed in landscape', () => {
    // resolveOutputSize(1440,1080,'landscape') → 1440x810
    const filter = buildFilterComplex(
      [
        { time: 0, pipX: 100, pipY: 100, pipVisible: true, cameraFullscreen: false },
        { time: 2, pipX: 120, pipY: 120, pipVisible: true, cameraFullscreen: false }
      ],
      320,
      'fill',
      1440,
      1080,
      1920,
      1080,
      true
    );
    expect(filter).toContain('scale=1440:810');
    expect(filter).toContain('force_original_aspect_ratio=increase');
    expect(filter).toContain('crop=1440:810');
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

  test('buildScreenFilter applies fit-mode padding when preprocessed in landscape', () => {
    // 1440x1080 source (4:3) in fit mode, preprocessed, landscape
    // resolveOutputSize(1440,1080,'landscape') → 1440x810
    const filter = buildScreenFilter(
      [{ time: 0, backgroundZoom: 1, backgroundPanX: 0, backgroundPanY: 0 }],
      'fit',
      1440,
      1080,
      1920,
      1080,
      '[screen]',
      true,
      30,
      'landscape'
    );
    expect(filter).toContain('scale=1440:810');
    expect(filter).toContain('force_original_aspect_ratio=decrease');
    expect(filter).toContain('pad=1440:810:');
    expect(filter).toContain('[screen]');
  });

  test('buildScreenFilter applies fill-mode crop when preprocessed in landscape', () => {
    // resolveOutputSize(1440,1080,'landscape') → 1440x810
    const filter = buildScreenFilter(
      [{ time: 0, backgroundZoom: 1, backgroundPanX: 0, backgroundPanY: 0 }],
      'fill',
      1440,
      1080,
      1920,
      1080,
      '[screen]',
      true,
      30,
      'landscape'
    );
    expect(filter).toContain('scale=1440:810');
    expect(filter).toContain('force_original_aspect_ratio=increase');
    expect(filter).toContain('crop=1440:810');
    expect(filter).toContain('[screen]');
  });

  test('buildScreenFilter applies fit-mode padding when preprocessed with background animation', () => {
    // Preprocessed + zoom > 1 + fit mode in landscape — zoompan input should be padded
    // resolveOutputSize(1440,1080,'landscape') → 1440x810
    const filter = buildScreenFilter(
      [
        { time: 0, backgroundZoom: 1.5, backgroundPanX: 0, backgroundPanY: 0 },
      ],
      'fit',
      1440,
      1080,
      1920,
      1080,
      '[screen]',
      true,
      30,
      'landscape'
    );
    expect(filter).toContain('force_original_aspect_ratio=decrease');
    expect(filter).toContain('pad=1440:810:');
    expect(filter).toContain('zoompan');
  });

  test('buildScreenFilter in reel mode + preprocessed does NOT apply landscape fit scaling', () => {
    // Source 3024x1964 (taller than 16:9): reel output is 1104x1964, landscape is 3024x1700
    // In reel mode, baseFilter should NOT scale to landscape dimensions because
    // reel crop (1104x1964) would exceed the landscape height (1700)
    const filter = buildScreenFilter(
      [{ time: 0, backgroundZoom: 1, backgroundPanX: 0, backgroundPanY: 0, reelCropX: 0 }],
      'fit',
      3024,
      1964,
      1920,
      1080,
      '[screen]',
      true,
      30,
      'reel'
    );
    // Should NOT contain landscape scale/pad
    expect(filter).not.toContain('scale=3024:1700');
    expect(filter).not.toContain('pad=3024:1700');
    // Should contain reel crop at source height
    expect(filter).toContain('crop=1104:1964:');
    expect(filter).toContain('[screen]');
  });

  test('buildFilterComplex in reel mode + preprocessed does NOT apply landscape fit scaling', () => {
    // Same source (3024x1964) through buildFilterComplex
    const filter = buildFilterComplex(
      [
        { time: 0, pipX: 100, pipY: 100, pipVisible: true, cameraFullscreen: false, backgroundZoom: 1, backgroundPanX: 0, backgroundPanY: 0, reelCropX: 0, pipScale: 0.33 }
      ],
      200,
      'fit',
      3024,
      1964,
      Math.round(1964 * 9 / 16),
      1964,
      true,
      30,
      'reel'
    );
    // Should NOT contain landscape scale/pad
    expect(filter).not.toContain('scale=3024:1700');
    expect(filter).not.toContain('pad=3024:1700');
    // Should contain reel crop at source height
    expect(filter).toContain('crop=1104:1964:');
  });

  test('buildScreenFilter in reel mode + preprocessed uses setpts without scale', () => {
    // For preprocessed reel, baseFilter should only apply setpts (no scale/pad)
    const filter = buildScreenFilter(
      [{ time: 0, backgroundZoom: 1, backgroundPanX: 0, backgroundPanY: 0, reelCropX: 0 }],
      'fit',
      1920,
      1080,
      1920,
      1080,
      '[screen]',
      true,
      30,
      'reel'
    );
    expect(filter).toContain('setpts=PTS-STARTPTS');
    // Should NOT apply landscape fit scaling in reel mode
    expect(filter).not.toContain('force_original_aspect_ratio');
    expect(filter).toContain('crop=608:1080:');
  });

  test('buildScreenFilter reel + preprocessed + zoom-out uses source dimensions not landscape', () => {
    // Source 3024x1964 (not 16:9), reel mode, preprocessed, with zoom-out
    // The zoom-out pipeline should use source dimensions (3024x1964) not landscape (3024x1700)
    const filter = buildScreenFilter(
      [
        { time: 0, backgroundZoom: 1, backgroundPanX: 0, backgroundPanY: 0, reelCropX: 0 },
        { time: 2, backgroundZoom: 0.7, backgroundPanX: 0, backgroundPanY: 0, reelCropX: 0 }
      ],
      'fit',
      3024,
      1964,
      1920,
      1080,
      '[screen]',
      true,
      30,
      'reel'
    );
    // Zoom-out pipeline should use source height (1964), not landscape height (1700)
    expect(filter).toContain('s=3024x1964');
    expect(filter).not.toContain('s=3024x1700');
    // Scale part should also use source dimensions
    expect(filter).toContain(`floor(3024*`);
    expect(filter).toContain(`floor(1964*`);
    expect(filter).not.toContain(`floor(1700*`);
    // Reel crop should use source height
    expect(filter).toContain('crop=1104:1964:');
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

  test('buildOverlayFilter returns empty for no overlays', () => {
    const result = buildOverlayFilter([], 1920, 1080, 1920, 1080, 2, 'screen');
    expect(result.inputs).toEqual([]);
    expect(result.filterParts).toEqual([]);
    expect(result.outputLabel).toBe('screen');
  });

  test('buildOverlayFilter generates image overlay filter', () => {
    const overlays = [{
      id: 'o1', mediaPath: 'overlay-media/img.png', mediaType: 'image',
      startTime: 5, endTime: 10, sourceStart: 0, sourceEnd: 5,
      landscape: { x: 200, y: 100, width: 400, height: 300 },
      reel: { x: 50, y: 100, width: 200, height: 150 }
    }];
    const result = buildOverlayFilter(overlays, 1920, 1080, 1920, 1080, 2, 'screen', 'landscape');
    expect(result.inputs.length).toBe(1);
    expect(result.inputs[0]).toContain('-loop');
    expect(result.filterParts.length).toBe(2); // prep + overlay
    expect(result.filterParts[0]).toContain('scale=400:300');
    expect(result.filterParts[0]).toContain('setpts=PTS+5.000/TB');
    expect(result.filterParts[0]).toContain('fade=in:st=5.000');
    expect(result.filterParts[0]).toContain('fade=out:st=9.700');
    expect(result.filterParts[1]).toContain("enable='between(t,5.000,10.000)'");
    expect(result.filterParts[1]).toContain("x='200'");
    expect(result.filterParts[1]).toContain("y='100'");
  });

  test('buildOverlayFilter generates video overlay filter', () => {
    const overlays = [{
      id: 'o1', mediaPath: 'overlay-media/vid.mp4', mediaType: 'video',
      startTime: 2, endTime: 8, sourceStart: 5, sourceEnd: 11,
      landscape: { x: 100, y: 50, width: 500, height: 300 },
      reel: { x: 50, y: 100, width: 200, height: 150 }
    }];
    const result = buildOverlayFilter(overlays, 1920, 1080, 1920, 1080, 2, 'screen', 'landscape');
    expect(result.inputs.length).toBe(1);
    expect(result.inputs[0]).not.toContain('-loop');
    expect(result.filterParts[0]).toContain('trim=start=5.000:end=11.000');
    expect(result.filterParts[0]).toContain('setpts=PTS-STARTPTS');
    expect(result.filterParts[0]).toContain('scale=500:300');
  });

  test('buildOverlayFilter handles multiple non-overlapping overlays', () => {
    const overlays = [
      { id: 'o1', mediaPath: 'a.png', mediaType: 'image', startTime: 0, endTime: 5, sourceStart: 0, sourceEnd: 5,
        landscape: { x: 0, y: 0, width: 200, height: 150 }, reel: { x: 0, y: 0, width: 100, height: 75 } },
      { id: 'o2', mediaPath: 'b.png', mediaType: 'image', startTime: 8, endTime: 12, sourceStart: 0, sourceEnd: 4,
        landscape: { x: 100, y: 100, width: 300, height: 200 }, reel: { x: 50, y: 50, width: 150, height: 100 } }
    ];
    const result = buildOverlayFilter(overlays, 1920, 1080, 1920, 1080, 2, 'screen', 'landscape');
    expect(result.inputs.length).toBe(2);
    expect(result.filterParts.length).toBe(4); // 2 prep + 2 overlay
    expect(result.filterParts[1]).toContain("enable='between(t,0.000,5.000)'");
    expect(result.filterParts[3]).toContain("enable='between(t,8.000,12.000)'");
  });

  test('buildOverlayFilter uses reel mode positions', () => {
    const overlays = [{
      id: 'o1', mediaPath: 'img.png', mediaType: 'image',
      startTime: 0, endTime: 5, sourceStart: 0, sourceEnd: 5,
      landscape: { x: 200, y: 100, width: 400, height: 300 },
      reel: { x: 50, y: 200, width: 300, height: 200 }
    }];
    const result = buildOverlayFilter(overlays, 608, 1080, 608, 1080, 2, 'screen', 'reel');
    expect(result.filterParts[0]).toContain('scale=300:200');
    expect(result.filterParts[1]).toContain("x='50'");
    expect(result.filterParts[1]).toContain("y='200'");
  });

  test('buildOverlayFilter skips fade between same-media adjacent segments', () => {
    const overlays = [
      { id: 'o1', mediaPath: 'img.png', mediaType: 'image', startTime: 0, endTime: 5, sourceStart: 0, sourceEnd: 5,
        landscape: { x: 100, y: 100, width: 400, height: 300 }, reel: { x: 0, y: 0, width: 200, height: 150 } },
      { id: 'o2', mediaPath: 'img.png', mediaType: 'image', startTime: 5, endTime: 10, sourceStart: 0, sourceEnd: 5,
        landscape: { x: 500, y: 300, width: 400, height: 300 }, reel: { x: 0, y: 0, width: 200, height: 150 } }
    ];
    const result = buildOverlayFilter(overlays, 1920, 1080, 1920, 1080, 2, 'screen', 'landscape');
    // First segment: fade-in only (no fade-out since next is same media)
    expect(result.filterParts[0]).toContain('fade=in');
    expect(result.filterParts[0]).not.toContain('fade=out');
    // Second segment: fade-out only (no fade-in since prev is same media)
    expect(result.filterParts[2]).not.toContain('fade=in');
    expect(result.filterParts[2]).toContain('fade=out');
  });
});
