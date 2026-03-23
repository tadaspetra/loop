const path = require('path');

const {
  sanitizeProjectName,
  toProjectAbsolutePath,
  toProjectRelativePath,
  normalizeSections,
  normalizeKeyframes,
  normalizeCameraSyncOffsetMs,
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

  test('normalizeProjectData preserves mic path metadata for takes', () => {
    const project = normalizeProjectData(
      {
        takes: [
          {
            id: 'take-1',
            screenPath: 'screen.webm',
            cameraPath: 'camera.webm',
            micPath: 'mic.webm',
            screenHasAudio: false,
            screenHasAudibleAudio: true,
            sections: [{ start: 0, end: 1, sourceStart: 0, sourceEnd: 1 }]
          }
        ]
      },
      '/tmp/my-project'
    );

    expect(project.takes[0].screenPath).toBe(path.join('/tmp/my-project', 'screen.webm'));
    expect(project.takes[0].cameraPath).toBe(path.join('/tmp/my-project', 'camera.webm'));
    expect(project.takes[0].micPath).toBe(path.join('/tmp/my-project', 'mic.webm'));
    expect(project.takes[0].screenHasAudio).toBe(false);
    expect(project.takes[0].screenHasAudibleAudio).toBe(true);
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
});
