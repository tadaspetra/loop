import { describe, expect, test } from 'vitest';

import {
  replaceTakeSections,
  resolveTargetTakeId,
  resolveTranscriptionSource
} from '../../src/renderer/features/timeline/transcribe-cut';

function makeTake(overrides: Record<string, unknown> = {}) {
  return {
    id: 'take-1',
    duration: 60,
    screenPath: '/p/recording-take-1-screen.webm',
    cameraPath: null,
    audioPath: null,
    audioSource: null,
    audioStartOffsetMs: 0,
    cameraStartOffsetMs: 0,
    ...overrides
  };
}

function makeSection(id: string, takeId: string | null, sourceStart: number, sourceEnd: number) {
  return {
    id,
    index: 0,
    label: '',
    start: sourceStart,
    end: sourceEnd,
    duration: sourceEnd - sourceStart,
    sourceStart,
    sourceEnd,
    takeId,
    transcript: '',
    imagePath: null
  };
}

describe('renderer/features/timeline/transcribe-cut', () => {
  describe('resolveTranscriptionSource', () => {
    test('external audio route uses the audio-only file and its offset', () => {
      const take = makeTake({
        audioSource: 'external',
        audioPath: '/p/recording-take-1-audio.webm',
        audioStartOffsetMs: 250
      });
      expect(resolveTranscriptionSource(take)).toEqual({
        sourcePath: '/p/recording-take-1-audio.webm',
        offsetSec: 0.25
      });
    });

    test('camera audio route uses the camera file and its offset', () => {
      const take = makeTake({
        audioSource: 'camera',
        cameraPath: '/p/recording-take-1-camera.webm',
        cameraStartOffsetMs: 120
      });
      expect(resolveTranscriptionSource(take)).toEqual({
        sourcePath: '/p/recording-take-1-camera.webm',
        offsetSec: 0.12
      });
    });

    test('returns null when there is no mic audio', () => {
      expect(resolveTranscriptionSource(makeTake())).toBeNull();
    });

    test('returns null when the routed file path is missing', () => {
      expect(resolveTranscriptionSource(makeTake({ audioSource: 'external' }))).toBeNull();
      expect(resolveTranscriptionSource(makeTake({ audioSource: 'camera' }))).toBeNull();
    });

    test('missing offsets default to zero', () => {
      const take = makeTake({
        audioSource: 'external',
        audioPath: '/p/a.webm',
        audioStartOffsetMs: undefined
      });
      expect(resolveTranscriptionSource(take)).toEqual({
        sourcePath: '/p/a.webm',
        offsetSec: 0
      });
    });

    test('returns null for malformed takes', () => {
      expect(resolveTranscriptionSource(null)).toBeNull();
      expect(resolveTranscriptionSource(undefined)).toBeNull();
      expect(resolveTranscriptionSource({} as never)).toBeNull();
    });
  });

  describe('resolveTargetTakeId', () => {
    const sections = [
      makeSection('s1', 'take-1', 0, 10),
      makeSection('s2', 'take-2', 0, 10),
      makeSection('s3', 'take-2', 12, 20)
    ];
    const takes = [makeTake({ id: 'take-1' }), makeTake({ id: 'take-2' })];

    test('prefers the take of the selected section', () => {
      expect(resolveTargetTakeId({ sections, selectedSectionId: 's1', takes })).toBe('take-1');
      expect(resolveTargetTakeId({ sections, selectedSectionId: 's3', takes })).toBe('take-2');
    });

    test('falls back to the latest take that has timeline sections', () => {
      expect(resolveTargetTakeId({ sections, selectedSectionId: null, takes })).toBe('take-2');
      expect(
        resolveTargetTakeId({ sections, selectedSectionId: 'missing', takes })
      ).toBe('take-2');
    });

    test('ignores takes that have no sections left on the timeline', () => {
      const onlyTakeOne = [makeSection('s1', 'take-1', 0, 10)];
      expect(
        resolveTargetTakeId({ sections: onlyTakeOne, selectedSectionId: null, takes })
      ).toBe('take-1');
    });

    test('returns null when nothing matches', () => {
      expect(resolveTargetTakeId({ sections: [], selectedSectionId: null, takes })).toBeNull();
      expect(
        resolveTargetTakeId({ sections, selectedSectionId: null, takes: [] })
      ).toBeNull();
    });
  });

  describe('replaceTakeSections', () => {
    test('replaces a contiguous run in place, preserving neighbours', () => {
      const sections = [
        makeSection('a', 'take-1', 0, 10),
        makeSection('b', 'take-2', 0, 30),
        makeSection('c', 'take-3', 0, 5)
      ];
      const replacements = [
        makeSection('n1', 'take-2', 2, 8),
        makeSection('n2', 'take-2', 12, 20)
      ];

      const result = replaceTakeSections(sections, 'take-2', replacements);

      expect(result.replacedCount).toBe(1);
      expect(result.sections.map((s) => s.id)).toEqual(['a', 'n1', 'n2', 'c']);
    });

    test('consolidates non-contiguous take sections at the first position', () => {
      const sections = [
        makeSection('b1', 'take-2', 0, 10),
        makeSection('a', 'take-1', 0, 10),
        makeSection('b2', 'take-2', 12, 20)
      ];
      const replacements = [makeSection('n1', 'take-2', 0, 20)];

      const result = replaceTakeSections(sections, 'take-2', replacements);

      expect(result.replacedCount).toBe(2);
      expect(result.sections.map((s) => s.id)).toEqual(['n1', 'a']);
    });

    test('returns the input unchanged when the take has no sections', () => {
      const sections = [makeSection('a', 'take-1', 0, 10)];
      const result = replaceTakeSections(sections, 'take-9', [
        makeSection('n1', 'take-9', 0, 5)
      ]);

      expect(result.replacedCount).toBe(0);
      expect(result.sections).toEqual(sections);
    });

    test('does not mutate the input array', () => {
      const sections = [
        makeSection('a', 'take-1', 0, 10),
        makeSection('b', 'take-2', 0, 30)
      ];
      const snapshot = JSON.parse(JSON.stringify(sections));

      replaceTakeSections(sections, 'take-2', [makeSection('n1', 'take-2', 0, 5)]);

      expect(sections).toEqual(snapshot);
    });

    test('handles malformed input defensively', () => {
      expect(replaceTakeSections(null as never, 'take-1', []).sections).toEqual([]);
      expect(replaceTakeSections([], 'take-1', []).replacedCount).toBe(0);
    });
  });
});
