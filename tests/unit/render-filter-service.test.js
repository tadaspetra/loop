const {
  buildPosExpr,
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

  test('buildFilterComplex returns overlay pipeline string', () => {
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
      1080
    );
    expect(filter).toContain('[screen]');
    expect(filter).toContain('[cam]');
    expect(filter).toContain('overlay');
  });
});
