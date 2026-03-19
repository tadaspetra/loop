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
  normalizeProjectData
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
    expect(keyframes[0].backgroundZoom).toBe(1);
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
});
