import path from 'node:path';

import { describe, expect, test } from 'vitest';

import {
  createDefaultProject,
  DEFAULT_PIP_SIZE,
  MAX_PIP_SIZE,
  MAX_RECORDER_START_OFFSET_MS,
  MIN_PIP_SIZE,
  normalizeKeyframes,
  normalizePipSize,
  normalizeProjectData,
  normalizeRecorderStartOffsetMs,
  normalizeExportVideoPreset,
  normalizeSections,
  normalizeTakeSpeechSegments,
  sanitizeProjectName,
  toProjectAbsolutePath,
  toProjectRelativePath
} from '../../src/shared/domain/project';

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
          keyframes: [
            {
              time: 0,
              pipX: 10,
              pipY: 20,
              backgroundZoom: 1.8,
              backgroundPanX: 0.25,
              backgroundPanY: -0.5
            }
          ]
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
    expect(project.settings.exportVideoPreset).toBe('quality');
    expect(project.settings.screenTransform).toBeNull();
  });

  test('normalizeProjectData normalizes the screen transform and defaults it to null', () => {
    const project = normalizeProjectData({
      settings: {
        screenTransform: { x: '800', y: 9999, scale: 1.25 }
      }
    });
    expect(project.settings.screenTransform).toEqual({ x: 800, y: 1080, scale: 1.25 });

    const invalid = normalizeProjectData({
      settings: {
        screenTransform: { x: 10, y: 10 }
      }
    });
    expect(invalid.settings.screenTransform).toBeNull();
    expect(createDefaultProject('Demo').settings.screenTransform).toBeNull();
  });

  test('normalizeProjectData drops the retired autoCutSilences setting', () => {
    const project = normalizeProjectData(
      {
        settings: {
          autoCutSilences: false
        }
      },
      '/tmp/my-project'
    );

    expect('autoCutSilences' in project.settings).toBe(false);
    expect('autoCutSilences' in createDefaultProject('Demo').settings).toBe(false);
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

  test('normalizeExportVideoPreset preserves fast and falls back to quality', () => {
    expect(normalizeExportVideoPreset('fast')).toBe('fast');
    expect(normalizeExportVideoPreset('quality')).toBe('quality');
    expect(normalizeExportVideoPreset('turbo')).toBe('quality');
    expect(createDefaultProject('Demo').settings.exportVideoPreset).toBe('quality');
  });

  test('normalizeProjectData preserves valid export video preset and falls back invalid values', () => {
    const fastProject = normalizeProjectData(
      {
        settings: {
          exportVideoPreset: 'fast'
        }
      },
      '/tmp/my-project'
    );
    const fallbackProject = normalizeProjectData(
      {
        settings: {
          exportVideoPreset: 'draft'
        }
      },
      '/tmp/my-project'
    );

    expect(fastProject.settings.exportVideoPreset).toBe('fast');
    expect(fallbackProject.settings.exportVideoPreset).toBe('quality');
  });

  test('normalizeProjectData ignores the retired cameraSyncOffsetMs setting on legacy files', () => {
    const project = normalizeProjectData(
      {
        settings: {
          cameraSyncOffsetMs: 135.4
        }
      },
      '/tmp/my-project'
    );

    expect(project.settings).not.toHaveProperty('cameraSyncOffsetMs');
    expect(createDefaultProject('Demo').settings).not.toHaveProperty('cameraSyncOffsetMs');
  });

  test('normalizePipSize clamps and defaults invalid values', () => {
    expect(normalizePipSize(undefined)).toBe(DEFAULT_PIP_SIZE);
    expect(normalizePipSize('bad')).toBe(DEFAULT_PIP_SIZE);
    expect(normalizePipSize(0)).toBe(DEFAULT_PIP_SIZE);
    expect(normalizePipSize(-10)).toBe(DEFAULT_PIP_SIZE);
    expect(normalizePipSize(32)).toBe(MIN_PIP_SIZE);
    expect(normalizePipSize(99999)).toBe(MAX_PIP_SIZE);
    expect(normalizePipSize(600.6)).toBe(601);
  });

  test('normalizeProjectData preserves valid pipSize and defaults invalid values', () => {
    const sized = normalizeProjectData({ settings: { pipSize: 500 } }, '/tmp/proj');
    const fallback = normalizeProjectData({ settings: { pipSize: 'huge' } }, '/tmp/proj');

    expect(sized.settings.pipSize).toBe(500);
    expect(fallback.settings.pipSize).toBe(DEFAULT_PIP_SIZE);
    expect(createDefaultProject('Demo').settings.pipSize).toBe(DEFAULT_PIP_SIZE);
  });

  test('normalizeSections preserves imagePath and defaults to null', () => {
    const sections = normalizeSections([
      { start: 0, end: 2, imagePath: '/tmp/photo.png' },
      { start: 3, end: 5 },
      { start: 6, end: 8, imagePath: '' }
    ]);

    expect(sections).toHaveLength(3);
    expect(sections[0].imagePath).toBe('/tmp/photo.png');
    expect(sections[1].imagePath).toBeNull();
    expect(sections[2].imagePath).toBeNull();
  });

  test('normalizeRecorderStartOffsetMs clamps invalid, negative, and huge values', () => {
    expect(normalizeRecorderStartOffsetMs(undefined)).toBe(0);
    expect(normalizeRecorderStartOffsetMs(null)).toBe(0);
    expect(normalizeRecorderStartOffsetMs('bad')).toBe(0);
    // Negative values mean "before anchor", which is meaningless under our
    // convention (anchor = earliest recorder); coerce to 0 so export does not
    // trim into negative source time.
    expect(normalizeRecorderStartOffsetMs(-120)).toBe(0);
    expect(normalizeRecorderStartOffsetMs(0)).toBe(0);
    expect(normalizeRecorderStartOffsetMs(145.4)).toBe(145);
    expect(normalizeRecorderStartOffsetMs(145.6)).toBe(146);
    // Anything beyond the sanity cap is clamped so a stuck/broken recorder
    // cannot produce a 30-minute trim shift and ruin an export silently.
    expect(normalizeRecorderStartOffsetMs(MAX_RECORDER_START_OFFSET_MS + 5000)).toBe(
      MAX_RECORDER_START_OFFSET_MS
    );
  });

  test('normalizeProjectData defaults missing recorder start offsets to 0 and preserves valid values', () => {
    const legacy = normalizeProjectData(
      {
        takes: [
          {
            id: 'take-1',
            screenPath: 'screen.webm',
            cameraPath: null,
            duration: 3,
            sections: []
          }
        ]
      },
      '/tmp/my-project'
    );

    expect(legacy.takes[0].screenStartOffsetMs).toBe(0);
    expect(legacy.takes[0].cameraStartOffsetMs).toBe(0);
    expect(legacy.takes[0].audioStartOffsetMs).toBe(0);

    const withOffsets = normalizeProjectData(
      {
        takes: [
          {
            id: 'take-1',
            screenPath: 'screen.webm',
            cameraPath: 'camera.webm',
            duration: 3,
            sections: [],
            screenStartOffsetMs: 0,
            cameraStartOffsetMs: 123.4,
            audioStartOffsetMs: 'bad'
          }
        ]
      },
      '/tmp/my-project'
    );

    expect(withOffsets.takes[0].screenStartOffsetMs).toBe(0);
    expect(withOffsets.takes[0].cameraStartOffsetMs).toBe(123);
    // Invalid values fall back to 0 instead of propagating NaN.
    expect(withOffsets.takes[0].audioStartOffsetMs).toBe(0);
  });

  test('normalizeProjectData resolves take proxyPath to absolute and defaults to null', () => {
    const project = normalizeProjectData(
      {
        takes: [
          {
            id: 'take-1',
            screenPath: 'screen.webm',
            cameraPath: null,
            proxyPath: 'screen-proxy.mp4',
            duration: 10,
            sections: []
          },
          { id: 'take-2', screenPath: 'screen2.webm', cameraPath: null, duration: 5, sections: [] }
        ]
      },
      '/tmp/my-project'
    );

    expect(project.takes[0].proxyPath).toBe('/tmp/my-project/screen-proxy.mp4');
    expect(project.takes[1].proxyPath).toBeNull();
  });

  test('normalizeTakeSpeechSegments drops invalid entries, sorts, and normalizes text', () => {
    const segments = normalizeTakeSpeechSegments([
      { start: 5, end: 6, text: '  later   words ' },
      { start: 1, end: 2, text: 'first' },
      { start: 3, end: 3, text: 'zero length dropped' },
      { start: Number.NaN, end: 4, text: 'invalid dropped' },
      { start: -1, end: 0.5, text: 'clamped' },
      'not-an-object'
    ]);

    expect(segments).toEqual([
      { start: 0, end: 0.5, text: 'clamped' },
      { start: 1, end: 2, text: 'first' },
      { start: 5, end: 6, text: 'later words' }
    ]);
    expect(normalizeTakeSpeechSegments(undefined)).toEqual([]);
    expect(normalizeTakeSpeechSegments('garbage')).toEqual([]);
  });

  test('normalizeProjectData round-trips take transcriptSegments', () => {
    const project = normalizeProjectData(
      {
        takes: [
          {
            id: 'take-1',
            screenPath: 'screen.webm',
            cameraPath: null,
            duration: 10,
            sections: [],
            transcriptSegments: [
              { start: 0.5, end: 2, text: 'hello there' },
              { start: 9, end: 'bad', text: 'dropped' }
            ]
          },
          { id: 'take-2', screenPath: 'screen2.webm', cameraPath: null, duration: 5, sections: [] }
        ]
      },
      '/tmp/my-project'
    );

    expect(project.takes[0].transcriptSegments).toEqual([
      { start: 0.5, end: 2, text: 'hello there' }
    ]);
    // Legacy takes without the field normalize to an empty array.
    expect(project.takes[1].transcriptSegments).toEqual([]);
  });

  test('normalizeSections deduplicates section IDs', () => {
    const sections = normalizeSections([
      { id: 'section-1', start: 0, end: 5, transcript: 'first' },
      { id: 'section-2', start: 5, end: 10, transcript: 'second' },
      { id: 'section-2', start: 10, end: 15, transcript: 'third with dupe id' },
      { id: 'section-3', start: 15, end: 20, transcript: 'fourth' }
    ]);

    expect(sections).toHaveLength(4);
    const ids = sections.map((s) => s.id);
    expect(new Set(ids).size).toBe(4);
    expect(ids[0]).toBe('section-1');
    expect(ids[1]).toBe('section-2');
    expect(ids[3]).toBe('section-3');
    // The duplicated ID should have been renamed
    expect(ids[2]).not.toBe('section-2');
    expect(sections[2].transcript).toBe('third with dupe id');
  });

  test('normalizeTakeSpeechSegments drops invalid entries, coerces text, and sorts by start', () => {
    expect(normalizeTakeSpeechSegments(undefined)).toEqual([]);
    expect(normalizeTakeSpeechSegments(null)).toEqual([]);
    expect(normalizeTakeSpeechSegments('bad')).toEqual([]);

    const segments = normalizeTakeSpeechSegments([
      { start: 4, end: 6, text: '  music ' },
      { start: 0, end: 1.5 },
      { start: 2, end: 2, text: 'zero-length drops' },
      { start: 3, end: 1, text: 'inverted drops' },
      { start: 'bad', end: 9, text: 'non-numeric drops' },
      { start: 7, end: Infinity, text: 'non-finite drops' },
      'not-a-record',
      { start: 8, end: 9, text: 42 }
    ]);

    expect(segments).toEqual([
      { start: 0, end: 1.5, text: '' },
      { start: 4, end: 6, text: 'music' },
      { start: 8, end: 9, text: '' }
    ]);
  });

  test('normalizeProjectData round-trips take systemAudioSegments and defaults legacy takes to empty', () => {
    const project = normalizeProjectData(
      {
        takes: [
          {
            id: 'take-1',
            screenPath: 'screen.webm',
            cameraPath: null,
            duration: 10,
            hasSystemAudio: true,
            sections: [],
            systemAudioSegments: [
              { start: 1.25, end: 3.5, text: '' },
              { start: 5, end: 4, text: 'invalid drops' }
            ]
          },
          { id: 'take-2', screenPath: 'screen2.webm', cameraPath: null, duration: 5, sections: [] }
        ]
      },
      '/tmp/my-project'
    );

    expect(project.takes[0].systemAudioSegments).toEqual([{ start: 1.25, end: 3.5, text: '' }]);
    // Legacy takes persisted before the field existed hydrate to an empty list.
    expect(project.takes[1].systemAudioSegments).toEqual([]);

    // Simulate save → load: re-normalizing the serialized project preserves the ranges.
    const reloaded = normalizeProjectData(JSON.parse(JSON.stringify(project)), '/tmp/my-project');
    expect(reloaded.takes[0].systemAudioSegments).toEqual([{ start: 1.25, end: 3.5, text: '' }]);
  });

  test('normalizeProjectData converts section imagePath to absolute path', () => {
    const project = normalizeProjectData(
      {
        timeline: {
          sections: [
            { start: 0, end: 2, imagePath: 'image-123-photo.png' },
            { start: 3, end: 5 }
          ]
        }
      },
      '/tmp/my-project'
    );

    expect(project.timeline.sections[0].imagePath).toBe('/tmp/my-project/image-123-photo.png');
    expect(project.timeline.sections[1].imagePath).toBeNull();
  });
});
