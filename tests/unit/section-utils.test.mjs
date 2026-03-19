import { describe, test, expect } from 'vitest';
import {
  roundMs,
  TRIM_PADDING,
  buildRemappedSectionsFromSegments,
  normalizeSections,
  buildDefaultSectionsForDuration,
  normalizeTakeSections,
  attachSectionTranscripts
} from '../../src/renderer/features/timeline/section-utils.js';

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
      expect(buildRemappedSectionsFromSegments(null)).toEqual([]);
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
    test('preserves saved field on sections', () => {
      const raw = [
        { start: 0, end: 3, saved: true },
        { start: 3, end: 6, saved: false },
        { start: 6, end: 9 }
      ];
      const result = normalizeSections(raw, 9);
      expect(result[0].saved).toBe(true);
      expect(result[1].saved).toBe(false);
      expect(result[2].saved).toBe(false);
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
