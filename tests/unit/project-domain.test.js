const path = require('path');

const {
  sanitizeProjectName,
  toProjectAbsolutePath,
  toProjectRelativePath,
  normalizeSections,
  normalizeSavedSections,
  normalizeKeyframes,
  normalizeBackgroundZoom,
  normalizeCameraSyncOffsetMs,
  normalizeReelCropX,
  normalizeOutputMode,
  normalizePipScale,
  createDefaultProject,
  normalizeProjectData,
  normalizePipSnapPoint,
  generateOverlayId,
  normalizeOverlayPosition,
  normalizeOverlays
} = require('../../src/shared/domain/project');

describe('shared/domain/project', () => {
  test('sanitizeProjectName strips invalid characters and collapses whitespace', () => {
    const value = sanitizeProjectName('  Bad<>:/Name   with   spaces  ');
    expect(value).toBe('BadName with spaces');
  });

  test('toProjectAbsolutePath and toProjectRelativePath convert paths safely', () => {
    const projectFolder = path.join('/tmp', 'project');
    const rel = path.join('takes', 'screen.webm');
    const abs = toProjectAbsolutePath(projectFolder, rel);
    expect(abs).toBe(path.join(projectFolder, rel));
    expect(toProjectRelativePath(projectFolder, abs)).toBe(rel);
  });

  test('normalizeSections sorts, filters invalid durations, and normalizes transcript', () => {
    const sections = normalizeSections([
      { start: 5, end: 6, text: '  world ' },
      { start: 0, end: 0, text: 'drop' },
      { start: 1, end: 2, transcript: 'hello    there' }
    ]);

    expect(sections).toHaveLength(2);
    expect(sections[0].start).toBe(1);
    expect(sections[0].transcript).toBe('hello there');
    expect(sections[1].start).toBe(5);
    expect(sections[1].transcript).toBe('world');
  });

  test('normalizeKeyframes returns ordered numeric values', () => {
    const keyframes = normalizeKeyframes([
      {
        time: 2,
        pipX: '50',
        pipY: '60',
        pipVisible: false,
        cameraFullscreen: true,
        backgroundZoom: '2.5',
        backgroundPanX: '0.4',
        backgroundPanY: '-0.2'
      },
      { time: 1, pipX: 10, pipY: 20, backgroundZoom: 0.25, backgroundPanX: -4, backgroundPanY: 4 },
      { time: 3, pipX: 20, pipY: 30, backgroundZoom: 9 }
    ]);
    expect(keyframes[0].time).toBe(1);
    expect(keyframes[1].pipX).toBe(50);
    expect(keyframes[1].pipVisible).toBe(false);
    expect(keyframes[1].cameraFullscreen).toBe(true);
    expect(keyframes[0].backgroundZoom).toBe(0.5); // 0.25 clamped to reel minimum (0.5)
    expect(keyframes[1].backgroundZoom).toBe(2.5);
    expect(keyframes[2].backgroundZoom).toBe(3);
    expect(keyframes[0].backgroundPanX).toBe(-1);
    expect(keyframes[0].backgroundPanY).toBe(1);
    expect(keyframes[1].backgroundPanX).toBe(0.4);
    expect(keyframes[1].backgroundPanY).toBe(-0.2);
    expect(keyframes[2].backgroundPanX).toBe(0);
    expect(keyframes[2].backgroundPanY).toBe(0);
  });

  test('normalizeProjectData hydrates defaults and timeline metadata', () => {
    const base = createDefaultProject('Demo');
    const project = normalizeProjectData(
      {
        id: base.id,
        name: '  demo<>name ',
        timeline: {
          sections: [{ start: 0, end: 2 }],
          keyframes: [{ time: 0, pipX: 10, pipY: 20, backgroundZoom: 1.8, backgroundPanX: 0.25, backgroundPanY: -0.5 }]
        }
      },
      '/tmp/my-project'
    );

    expect(project.name).toBe('demoname');
    expect(project.timeline.sections).toHaveLength(1);
    expect(project.timeline.keyframes[0].backgroundZoom).toBe(1.8);
    expect(project.timeline.keyframes[0].backgroundPanX).toBe(0.25);
    expect(project.timeline.keyframes[0].backgroundPanY).toBe(-0.5);
    expect(project.settings.screenFitMode).toBe('fill');
    expect(project.settings.hideFromRecording).toBe(true);
    expect(project.settings.exportAudioPreset).toBe('compressed');
  });

  test('normalizeProjectData preserves valid export audio preset and falls back invalid values', () => {
    const compressedProject = normalizeProjectData(
      {
        settings: {
          exportAudioPreset: 'compressed'
        }
      },
      '/tmp/my-project'
    );
    const fallbackProject = normalizeProjectData(
      {
        settings: {
          exportAudioPreset: 'loud'
        }
      },
      '/tmp/my-project'
    );

    expect(compressedProject.settings.exportAudioPreset).toBe('compressed');
    expect(fallbackProject.settings.exportAudioPreset).toBe('compressed');
    expect(createDefaultProject('Demo').settings.exportAudioPreset).toBe('compressed');
  });

  test('normalizeCameraSyncOffsetMs rounds and clamps camera sync offset values', () => {
    expect(normalizeCameraSyncOffsetMs()).toBe(0);
    expect(normalizeCameraSyncOffsetMs('125.7')).toBe(126);
    expect(normalizeCameraSyncOffsetMs('-1999.6')).toBe(-2000);
    expect(normalizeCameraSyncOffsetMs(5000)).toBe(2000);
    expect(normalizeCameraSyncOffsetMs(-5000)).toBe(-2000);
    expect(normalizeCameraSyncOffsetMs('nope')).toBe(0);
  });

  test('normalizeProjectData preserves valid camera sync offset and defaults invalid values', () => {
    const project = normalizeProjectData(
      {
        settings: {
          cameraSyncOffsetMs: 135.4
        }
      },
      '/tmp/my-project'
    );
    const fallbackProject = normalizeProjectData(
      {
        settings: {
          cameraSyncOffsetMs: 'bad'
        }
      },
      '/tmp/my-project'
    );

    expect(project.settings.cameraSyncOffsetMs).toBe(135);
    expect(fallbackProject.settings.cameraSyncOffsetMs).toBe(0);
    expect(createDefaultProject('Demo').settings.cameraSyncOffsetMs).toBe(0);
  });

  test('normalizeReelCropX clamps to [-1, 1] and defaults invalid input to 0', () => {
    expect(normalizeReelCropX(0.5)).toBe(0.5);
    expect(normalizeReelCropX(-0.75)).toBe(-0.75);
    expect(normalizeReelCropX(-2.5)).toBe(-1);
    expect(normalizeReelCropX(3.0)).toBe(1);
    expect(normalizeReelCropX(undefined)).toBe(0);
    expect(normalizeReelCropX(null)).toBe(0);
    expect(normalizeReelCropX(NaN)).toBe(0);
    expect(normalizeReelCropX('nope')).toBe(0);
  });

  test('normalizeOutputMode returns reel for reel and landscape for anything else', () => {
    expect(normalizeOutputMode('reel')).toBe('reel');
    expect(normalizeOutputMode('landscape')).toBe('landscape');
    expect(normalizeOutputMode(undefined)).toBe('landscape');
    expect(normalizeOutputMode(null)).toBe('landscape');
    expect(normalizeOutputMode('')).toBe('landscape');
    expect(normalizeOutputMode('portrait')).toBe('landscape');
  });

  test('normalizeBackgroundZoom clamps to [1, 3] by default (backward compat)', () => {
    expect(normalizeBackgroundZoom(2)).toBe(2);
    expect(normalizeBackgroundZoom(1)).toBe(1);
    expect(normalizeBackgroundZoom(3)).toBe(3);
    expect(normalizeBackgroundZoom(0.5)).toBe(1);
    expect(normalizeBackgroundZoom(5)).toBe(3);
    expect(normalizeBackgroundZoom(null)).toBe(1);
    expect(normalizeBackgroundZoom(undefined)).toBe(1);
    expect(normalizeBackgroundZoom(NaN)).toBe(1);
  });

  test('normalizeBackgroundZoom with reel mode clamps to [0.5, 3]', () => {
    expect(normalizeBackgroundZoom(0.5, 'reel')).toBe(0.5);
    expect(normalizeBackgroundZoom(0.7, 'reel')).toBe(0.7);
    expect(normalizeBackgroundZoom(0.3, 'reel')).toBe(0.5);
    expect(normalizeBackgroundZoom(2, 'reel')).toBe(2);
    expect(normalizeBackgroundZoom(5, 'reel')).toBe(3);
    expect(normalizeBackgroundZoom(null, 'reel')).toBe(0.5);
    expect(normalizeBackgroundZoom(NaN, 'reel')).toBe(0.5);
  });

  test('normalizeBackgroundZoom with landscape mode keeps [1, 3]', () => {
    expect(normalizeBackgroundZoom(0.5, 'landscape')).toBe(1);
    expect(normalizeBackgroundZoom(1, 'landscape')).toBe(1);
  });

  test('normalizePipScale clamps to [0.15, 0.50] and defaults invalid input to 0.22', () => {
    expect(normalizePipScale(0.35)).toBe(0.35);
    expect(normalizePipScale(0.15)).toBe(0.15);
    expect(normalizePipScale(0.50)).toBe(0.50);
    expect(normalizePipScale(0.05)).toBe(0.15);
    expect(normalizePipScale(0.8)).toBe(0.50);
    expect(normalizePipScale(undefined)).toBe(0.22);
    expect(normalizePipScale(null)).toBe(0.22);
    expect(normalizePipScale(NaN)).toBe(0.22);
  });

  test('normalizeKeyframes includes reelCropX property', () => {
    const keyframes = normalizeKeyframes([
      { time: 0, pipX: 10, pipY: 20, reelCropX: 0.5 },
      { time: 1, pipX: 30, pipY: 40, reelCropX: -2 },
      { time: 2, pipX: 50, pipY: 60 }
    ]);
    expect(keyframes[0].reelCropX).toBe(0.5);
    expect(keyframes[1].reelCropX).toBe(-1);
    expect(keyframes[2].reelCropX).toBe(0);
  });

  test('normalizeKeyframes includes pipScale property', () => {
    const keyframes = normalizeKeyframes([
      { time: 0, pipX: 10, pipY: 20, pipScale: 0.35 },
      { time: 1, pipX: 30, pipY: 40, pipScale: 0.05 },
      { time: 2, pipX: 50, pipY: 60, pipScale: 0.8 },
      { time: 3, pipX: 70, pipY: 80 }
    ]);
    expect(keyframes[0].pipScale).toBe(0.35);
    expect(keyframes[1].pipScale).toBe(0.15);
    expect(keyframes[2].pipScale).toBe(0.50);
    expect(keyframes[3].pipScale).toBe(0.22);
  });

  test('normalizeKeyframes preserves reel zoom-out values (0.5-1.0)', () => {
    const keyframes = normalizeKeyframes([
      { time: 0, pipX: 10, pipY: 20, backgroundZoom: 0.7 },
      { time: 1, pipX: 30, pipY: 40, backgroundZoom: 0.5 },
      { time: 2, pipX: 50, pipY: 60, backgroundZoom: 0.3 }
    ]);
    expect(keyframes[0].backgroundZoom).toBe(0.7); // preserved (within reel range)
    expect(keyframes[1].backgroundZoom).toBe(0.5); // preserved (reel minimum)
    expect(keyframes[2].backgroundZoom).toBe(0.5); // clamped to reel minimum
  });

  test('normalizePipSnapPoint preserves valid values and defaults invalid', () => {
    expect(normalizePipSnapPoint('tl')).toBe('tl');
    expect(normalizePipSnapPoint('tc')).toBe('tc');
    expect(normalizePipSnapPoint('tr')).toBe('tr');
    expect(normalizePipSnapPoint('ml')).toBe('ml');
    expect(normalizePipSnapPoint('center')).toBe('center');
    expect(normalizePipSnapPoint('mr')).toBe('mr');
    expect(normalizePipSnapPoint('bl')).toBe('bl');
    expect(normalizePipSnapPoint('bc')).toBe('bc');
    expect(normalizePipSnapPoint('br')).toBe('br');
    expect(normalizePipSnapPoint(undefined)).toBe('br');
    expect(normalizePipSnapPoint(null)).toBe('br');
    expect(normalizePipSnapPoint('invalid')).toBe('br');
    expect(normalizePipSnapPoint(42)).toBe('br');
  });

  test('normalizeKeyframes includes pipSnapPoint property', () => {
    const keyframes = normalizeKeyframes([
      { time: 0, pipX: 10, pipY: 20, pipSnapPoint: 'center' },
      { time: 1, pipX: 30, pipY: 40, pipSnapPoint: 'tl' },
      { time: 2, pipX: 50, pipY: 60 },
      { time: 3, pipX: 70, pipY: 80, pipSnapPoint: 'invalid' }
    ]);
    expect(keyframes[0].pipSnapPoint).toBe('center');
    expect(keyframes[1].pipSnapPoint).toBe('tl');
    expect(keyframes[2].pipSnapPoint).toBe('br'); // default
    expect(keyframes[3].pipSnapPoint).toBe('br'); // invalid → default
  });

  test('createDefaultProject includes outputMode and pipScale in settings', () => {
    const project = createDefaultProject('Test');
    expect(project.settings.outputMode).toBe('landscape');
    expect(project.settings.pipScale).toBe(0.22);
  });

  test('normalizeProjectData hydrates outputMode and pipScale in settings', () => {
    const reelProject = normalizeProjectData(
      { settings: { outputMode: 'reel', pipScale: 0.35 } },
      '/tmp/my-project'
    );
    expect(reelProject.settings.outputMode).toBe('reel');
    expect(reelProject.settings.pipScale).toBe(0.35);

    const defaultProject = normalizeProjectData(
      { settings: {} },
      '/tmp/my-project'
    );
    expect(defaultProject.settings.outputMode).toBe('landscape');
    expect(defaultProject.settings.pipScale).toBe(0.22);

    const invalidProject = normalizeProjectData(
      { settings: { outputMode: 'weird', pipScale: 'bad' } },
      '/tmp/my-project'
    );
    expect(invalidProject.settings.outputMode).toBe('landscape');
    expect(invalidProject.settings.pipScale).toBe(0.22);
  });

  test('normalizeSections preserves saved field', () => {
    const sections = normalizeSections([
      { start: 0, end: 2, saved: true },
      { start: 2, end: 4, saved: false },
      { start: 4, end: 6 }
    ]);
    expect(sections[0].saved).toBe(true);
    expect(sections[1].saved).toBe(false);
    expect(sections[2].saved).toBe(false);
  });

  test('normalizeSavedSections normalizes and forces saved: true', () => {
    const saved = normalizeSavedSections([
      { start: 0, end: 2, transcript: 'hello', saved: false },
      { start: 2, end: 4, transcript: 'world' }
    ]);
    expect(saved).toHaveLength(2);
    expect(saved[0].saved).toBe(true);
    expect(saved[1].saved).toBe(true);
    expect(saved[0].transcript).toBe('hello');
  });

  test('normalizeSavedSections handles invalid input', () => {
    expect(normalizeSavedSections(null)).toEqual([]);
    expect(normalizeSavedSections(undefined)).toEqual([]);
    expect(normalizeSavedSections('not-array')).toEqual([]);
    expect(normalizeSavedSections([])).toEqual([]);
  });

  test('normalizeProjectData includes savedSections in timeline', () => {
    const project = normalizeProjectData(
      {
        timeline: {
          sections: [{ start: 0, end: 2, takeId: 'take-1' }],
          savedSections: [{ start: 2, end: 4, takeId: 'take-2', saved: true }]
        }
      },
      '/tmp/my-project'
    );
    expect(project.timeline.savedSections).toHaveLength(1);
    expect(project.timeline.savedSections[0].saved).toBe(true);
    expect(project.timeline.savedSections[0].takeId).toBe('take-2');
  });

  test('normalizeProjectData defaults savedSections to empty array', () => {
    const project = normalizeProjectData(
      { timeline: { sections: [{ start: 0, end: 2 }] } },
      '/tmp/my-project'
    );
    expect(project.timeline.savedSections).toEqual([]);
  });

  test('generateOverlayId returns unique IDs', () => {
    const id1 = generateOverlayId();
    const id2 = generateOverlayId();
    expect(id1).toMatch(/^overlay-\d+-\d+$/);
    expect(id2).toMatch(/^overlay-\d+-\d+$/);
    expect(id1).not.toBe(id2);
  });

  test('normalizeOverlayPosition validates and defaults', () => {
    expect(normalizeOverlayPosition(null)).toEqual({ x: 0, y: 0, width: 400, height: 300 });
    expect(normalizeOverlayPosition({})).toEqual({ x: 0, y: 0, width: 400, height: 300 });
    expect(normalizeOverlayPosition({ x: 100, y: 200, width: 500, height: 400 }))
      .toEqual({ x: 100, y: 200, width: 500, height: 400 });
    expect(normalizeOverlayPosition({ x: -50, y: 'bad', width: 0, height: 300 }))
      .toEqual({ x: -50, y: 0, width: 400, height: 300 });
  });

  test('normalizeOverlays returns empty array for non-array input', () => {
    expect(normalizeOverlays(null)).toEqual([]);
    expect(normalizeOverlays(undefined)).toEqual([]);
    expect(normalizeOverlays('string')).toEqual([]);
  });

  test('normalizeOverlays filters invalid segments', () => {
    const result = normalizeOverlays([
      { id: 'o1', mediaPath: 'img.png', mediaType: 'image', startTime: 0, endTime: 5 },
      { id: '', mediaPath: 'img.png', mediaType: 'image', startTime: 5, endTime: 10 },
      { mediaPath: 'img.png', mediaType: 'image', startTime: 10, endTime: 15 },
      { id: 'o4', mediaPath: '', mediaType: 'image', startTime: 15, endTime: 20 },
      { id: 'o5', mediaPath: 'img.png', mediaType: 'invalid', startTime: 20, endTime: 25 },
      { id: 'o6', mediaPath: 'img.png', mediaType: 'image', startTime: 10, endTime: 5 }
    ]);
    expect(result.length).toBe(1);
    expect(result[0].id).toBe('o1');
  });

  test('normalizeOverlays sorts by startTime', () => {
    const result = normalizeOverlays([
      { id: 'b', mediaPath: 'b.png', mediaType: 'image', startTime: 10, endTime: 15 },
      { id: 'a', mediaPath: 'a.png', mediaType: 'image', startTime: 2, endTime: 5 }
    ]);
    expect(result[0].id).toBe('a');
    expect(result[1].id).toBe('b');
  });

  test('normalizeOverlays enforces no-overlap by trimming later segment', () => {
    const result = normalizeOverlays([
      { id: 'a', mediaPath: 'a.png', mediaType: 'image', startTime: 2, endTime: 8 },
      { id: 'b', mediaPath: 'b.png', mediaType: 'image', startTime: 5, endTime: 12 }
    ]);
    expect(result.length).toBe(2);
    expect(result[0].endTime).toBe(8);
    expect(result[1].startTime).toBe(8);
    expect(result[1].endTime).toBe(12);
  });

  test('normalizeOverlays sets image sourceStart/sourceEnd', () => {
    const result = normalizeOverlays([
      { id: 'o1', mediaPath: 'img.png', mediaType: 'image', startTime: 0, endTime: 5, sourceStart: 99, sourceEnd: 99 }
    ]);
    expect(result[0].sourceStart).toBe(0);
    expect(result[0].sourceEnd).toBe(5);
  });

  test('normalizeOverlays preserves video sourceStart/sourceEnd', () => {
    const result = normalizeOverlays([
      { id: 'o1', mediaPath: 'vid.mp4', mediaType: 'video', startTime: 0, endTime: 10, sourceStart: 5, sourceEnd: 15 }
    ]);
    expect(result[0].sourceStart).toBe(5);
    expect(result[0].sourceEnd).toBe(15);
  });

  test('normalizeOverlays defaults video sourceStart/sourceEnd when missing', () => {
    const result = normalizeOverlays([
      { id: 'o1', mediaPath: 'vid.mp4', mediaType: 'video', startTime: 2, endTime: 8 }
    ]);
    expect(result[0].sourceStart).toBe(0);
    expect(result[0].sourceEnd).toBe(6);
  });

  test('normalizeOverlays normalizes landscape and reel positions', () => {
    const result = normalizeOverlays([
      { id: 'o1', mediaPath: 'img.png', mediaType: 'image', startTime: 0, endTime: 5,
        landscape: { x: 100, y: 200, width: 300, height: 250 },
        reel: { x: 50, y: 100, width: 200, height: 150 } }
    ]);
    expect(result[0].landscape).toEqual({ x: 100, y: 200, width: 300, height: 250 });
    expect(result[0].reel).toEqual({ x: 50, y: 100, width: 200, height: 150 });
  });

  test('normalizeOverlays removes fully overlapped segment', () => {
    const result = normalizeOverlays([
      { id: 'a', mediaPath: 'a.png', mediaType: 'image', startTime: 0, endTime: 10 },
      { id: 'b', mediaPath: 'b.png', mediaType: 'image', startTime: 3, endTime: 5 }
    ]);
    // b starts at 3, but a ends at 10, so b.startTime becomes 10, but b.endTime is 5 < 10 → removed
    expect(result.length).toBe(1);
    expect(result[0].id).toBe('a');
  });

  test('normalizeProjectData includes overlays in timeline', () => {
    const project = normalizeProjectData(
      { timeline: { overlays: [
        { id: 'o1', mediaPath: 'img.png', mediaType: 'image', startTime: 0, endTime: 5 }
      ] } },
      '/tmp/project'
    );
    expect(project.timeline.overlays.length).toBe(1);
    expect(project.timeline.overlays[0].id).toBe('o1');
  });
});
