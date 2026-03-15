const {
  buildPosExpr,
  buildNumericExpr,
  buildAlphaExpr,
  buildCamFullAlphaExpr,
  buildFilterComplex
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
    expect(filter).toContain(":x='(iw-iw/zoom)*((if(gte(it,2.000),1.000");
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
});
