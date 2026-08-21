import { describe, expect, test } from 'vitest';

import {
  attachSectionTranscripts,
  buildRecordingSectionsForTimeline,
  buildDefaultSectionsForDuration,
  buildRemappedSectionsFromSegments,
  normalizeSections,
  normalizeTakeSections,
  roundMs,
  TRIM_PADDING
} from '../../src/renderer/features/timeline/section-utils';

describe('section-utils', () => {
  describe('roundMs', () => {
    test('rounds to 3 decimal places', () => {
      expect(roundMs(1.23456)).toBe(1.235);
      expect(roundMs(0.001)).toBe(0.001);
    });
  });

  describe('TRIM_PADDING', () => {
    test('is 0.15', () => {
      expect(TRIM_PADDING).toBe(0.15);
    });
  });

  describe('buildRemappedSectionsFromSegments', () => {
    test('returns empty for empty or non-array input', () => {
      expect(buildRemappedSectionsFromSegments([])).toEqual([]);
      expect(buildRemappedSectionsFromSegments(null as unknown as [])).toEqual([]);
    });
    test('builds sections with padding and timeline mapping', () => {
      const segments = [
        { start: 1, end: 2, text: 'hello' },
        { start: 3, end: 4, text: 'world' }
      ];
      const result = buildRemappedSectionsFromSegments(segments);
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('section-1');
      expect(result[0].transcript).toBe('hello');
      expect(result[1].transcript).toBe('world');
      expect(result[0].sourceStart).toBeLessThan(1);
      expect(result[0].sourceEnd).toBeGreaterThan(2);
    });
    test('merges overlapping segments', () => {
      const segments = [
        { start: 0, end: 1, text: 'a' },
        { start: 0.5, end: 1.5, text: 'b' }
      ];
      const result = buildRemappedSectionsFromSegments(segments);
      expect(result).toHaveLength(1);
      expect(result[0].transcript).toMatch(/a/);
      expect(result[0].transcript).toMatch(/b/);
    });
  });

  describe('normalizeSections', () => {
    test('returns empty for zero duration and no input', () => {
      expect(normalizeSections([], 0)).toEqual([]);
    });
    test('creates default section when input empty but duration > 0', () => {
      const result = normalizeSections([], 10);
      expect(result).toHaveLength(1);
      expect(result[0].start).toBe(0);
      expect(result[0].end).toBe(10);
      expect(result[0].label).toBe('Section 1');
    });
    test('normalizes raw sections with transcript', () => {
      const raw = [{ start: 0, end: 5, transcript: '  hello  world  ' }];
      const result = normalizeSections(raw, 10);
      expect(result[0].transcript).toBe('hello world');
      expect(result[0].index).toBe(0);
      expect(result[0].duration).toBe(5);
    });
  });

  describe('buildDefaultSectionsForDuration', () => {
    test('returns empty for zero or negative duration', () => {
      expect(buildDefaultSectionsForDuration(0)).toEqual([]);
      expect(buildDefaultSectionsForDuration(-1)).toEqual([]);
    });
    test('returns single section spanning duration', () => {
      const result = buildDefaultSectionsForDuration(5);
      expect(result).toHaveLength(1);
      expect(result[0].sourceStart).toBe(0);
      expect(result[0].sourceEnd).toBe(5);
      expect(result[0].start).toBe(0);
      expect(result[0].end).toBe(5);
    });
  });

  describe('normalizeTakeSections', () => {
    test('falls back to default when normalizeSections returns empty', () => {
      const result = normalizeTakeSections([], 5);
      expect(result).toHaveLength(1);
      expect(result[0].end).toBe(5);
    });
    test('uses normalized sections when available', () => {
      const raw = [{ start: 0, end: 3 }];
      const result = normalizeTakeSections(raw, 10);
      expect(result).toHaveLength(1);
      expect(result[0].end).toBe(3);
    });
  });

  describe('buildRecordingSectionsForTimeline', () => {
    test('keeps the full recording when automatic silence cutting is disabled', () => {
      const result = buildRecordingSectionsForTimeline({
        recordedDuration: 12,
        autoCutSilences: false,
        activeSegments: [
          { start: 1, end: 2, text: 'hello' },
          { start: 8, end: 9, text: 'world' }
        ]
      });

      expect(result).toEqual(buildDefaultSectionsForDuration(12));
    });

    test('uses detected segments when automatic silence cutting is enabled', () => {
      const result = buildRecordingSectionsForTimeline({
        recordedDuration: 12,
        autoCutSilences: true,
        activeSegments: [
          { start: 1, end: 2, text: 'hello' },
          { start: 8, end: 9, text: 'world' }
        ]
      });

      expect(result).toHaveLength(2);
      expect(result[0].sourceStart).toBeLessThan(1);
      expect(result[0].sourceEnd).toBeGreaterThan(2);
      expect(result[0].transcript).toBe('hello');
      expect(result[1].transcript).toBe('world');
    });

    test('attaches transcript text to computed sections', () => {
      const result = buildRecordingSectionsForTimeline({
        recordedDuration: 12,
        activeSegments: [{ start: 1, end: 2, text: 'hello' }],
        computedSections: [
          { id: 'computed-1', start: 0, end: 2, sourceStart: 0.85, sourceEnd: 2.15 }
        ]
      });

      expect(result[0].id).toBe('computed-1');
      expect(result[0].transcript).toBe('hello');
    });

    test('clamps fallback and computed source ranges to the recording duration', () => {
      const fallback = buildRecordingSectionsForTimeline({
        recordedDuration: 10,
        activeSegments: [{ start: 9.8, end: 9.95, text: 'ending' }]
      });
      const computed = buildRecordingSectionsForTimeline({
        recordedDuration: 10,
        activeSegments: [{ start: 9.8, end: 9.95, text: 'ending' }],
        computedSections: [
          { id: 'computed-1', start: 0, end: 0.3, sourceStart: 9.8, sourceEnd: 10.1 }
        ]
      });

      expect(fallback[0]).toMatchObject({
        sourceStart: 9.65,
        sourceEnd: 10,
        start: 0,
        end: 0.35,
        duration: 0.35
      });
      expect(computed[0]).toMatchObject({
        sourceStart: 9.8,
        sourceEnd: 10,
        start: 0,
        end: 0.2,
        duration: 0.2
      });
    });
  });

  describe('attachSectionTranscripts', () => {
    test('preserves existing transcript on section', () => {
      const sections = [{ id: 's1', transcript: 'existing' }];
      const result = attachSectionTranscripts(sections, []);
      expect(result[0].transcript).toBe('existing');
    });
    test('attaches by index when no existing transcript', () => {
      const sections = [{ id: 's1', sourceStart: 0, sourceEnd: 1 }];
      const transcriptSource = [{ transcript: 'from index' }];
      const result = attachSectionTranscripts(sections, transcriptSource);
      expect(result[0].transcript).toBe('from index');
    });
    test('handles empty inputs', () => {
      expect(attachSectionTranscripts([], [])).toEqual([]);
    });
  });
});
