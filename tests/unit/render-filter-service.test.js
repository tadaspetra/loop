const {
  buildPosExpr,
  buildAlphaExpr,
  buildCamFullAlphaExpr,
  buildFilterComplex
} = require('../../src/main/services/render-filter-service');

describe('main/services/render-filter-service', () => {
  test('buildPosExpr generates interpolation expression for PiP transitions', () => {
    const expr = buildPosExpr(
      [
        { time: 0, pipX: 100, cameraFullscreen: false },
        { time: 1, pipX: 200, cameraFullscreen: false }
      ],
      'pipX'
    );
    expect(expr).toContain('if(gte(t,1.300)');
    expect(expr).toContain('200');
  });

  test('buildAlphaExpr handles visibility transitions', () => {
    const expr = buildAlphaExpr([
      { time: 0, pipVisible: true },
      { time: 2, pipVisible: false }
    ]);
    expect(expr).toContain('if(gte(T,2.300),0');
  });

  test('buildCamFullAlphaExpr handles fullscreen fade transitions', () => {
    const expr = buildCamFullAlphaExpr([
      { time: 0, pipVisible: true, cameraFullscreen: false },
      { time: 1, pipVisible: true, cameraFullscreen: true }
    ]);
    expect(expr).toContain('if(gte(T,1.300),1');
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
