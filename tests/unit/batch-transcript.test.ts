import { describe, expect, test } from 'vitest';

import {
  BATCH_SEGMENT_MAX_GAP_SEC,
  buildSegmentsFromWords,
  getTranscriptionTimeoutMs,
  TRANSCRIPTION_TIMEOUT_MAX_MS,
  TRANSCRIPTION_TIMEOUT_MIN_MS
} from '../../src/renderer/features/transcript/batch-transcript';

describe('renderer/features/transcript/batch-transcript', () => {
  describe('buildSegmentsFromWords', () => {
    test('groups consecutive words into one segment', () => {
      const words = [
        { text: 'Hello', start: 0.2, end: 0.6, type: 'word' },
        { text: 'there', start: 0.7, end: 1.0, type: 'word' },
        { text: 'friend', start: 1.1, end: 1.5, type: 'word' }
      ];
      expect(buildSegmentsFromWords(words)).toEqual([
        { start: 0.2, end: 1.5, text: 'Hello there friend' }
      ]);
    });

    test('splits segments when the gap between words exceeds the max gap', () => {
      const words = [
        { text: 'First', start: 0, end: 0.5, type: 'word' },
        { text: 'part', start: 0.6, end: 1.0, type: 'word' },
        // 2.5s silence — new segment
        { text: 'Second', start: 3.5, end: 4.0, type: 'word' },
        { text: 'part', start: 4.1, end: 4.4, type: 'word' }
      ];
      expect(buildSegmentsFromWords(words, { maxGapSec: 1.5 })).toEqual([
        { start: 0, end: 1.0, text: 'First part' },
        { start: 3.5, end: 4.4, text: 'Second part' }
      ]);
    });

    test('a gap exactly at the threshold does not split', () => {
      const words = [
        { text: 'a', start: 0, end: 0.5, type: 'word' },
        { text: 'b', start: 2.0, end: 2.4, type: 'word' }
      ];
      expect(buildSegmentsFromWords(words, { maxGapSec: 1.5 })).toHaveLength(1);
    });

    test('applies the recording-time offset to every segment', () => {
      const words = [
        { text: 'Offset', start: 1.0, end: 1.4, type: 'word' },
        { text: 'test', start: 4.0, end: 4.5, type: 'word' }
      ];
      const segments = buildSegmentsFromWords(words, { offsetSec: 0.25, maxGapSec: 1.5 });
      expect(segments).toEqual([
        { start: 1.25, end: 1.65, text: 'Offset' },
        { start: 4.25, end: 4.75, text: 'test' }
      ]);
    });

    test('ignores spacing and audio_event tokens for text and boundaries', () => {
      const words = [
        { text: 'Real', start: 0.1, end: 0.4, type: 'word' },
        { text: ' ', start: 0.4, end: 0.5, type: 'spacing' },
        { text: '(laughs)', start: 0.5, end: 1.2, type: 'audio_event' },
        { text: 'words', start: 1.3, end: 1.7, type: 'word' }
      ];
      expect(buildSegmentsFromWords(words)).toEqual([
        { start: 0.1, end: 1.7, text: 'Real words' }
      ]);
    });

    test('strips bracketed non-speech annotations from segment text', () => {
      const words = [
        { text: '[music]', start: 0, end: 0.4, type: 'word' },
        { text: 'speech', start: 0.5, end: 1.0, type: 'word' }
      ];
      const segments = buildSegmentsFromWords(words);
      expect(segments).toHaveLength(1);
      expect(segments[0].text).toBe('speech');
    });

    test('skips words with missing or non-finite timestamps', () => {
      const words = [
        { text: 'good', start: 0, end: 0.5, type: 'word' },
        { text: 'bad', type: 'word' },
        { text: 'worse', start: Number.NaN, end: 1.0, type: 'word' },
        { text: 'fine', start: 0.8, end: 1.2, type: 'word' }
      ];
      expect(buildSegmentsFromWords(words)).toEqual([
        { start: 0, end: 1.2, text: 'good fine' }
      ]);
    });

    test('drops segments whose text is empty after annotation stripping', () => {
      const words = [
        { text: '[silence]', start: 0, end: 0.5, type: 'word' },
        // far gap → its own segment, which strips to empty text
        { text: 'kept', start: 10, end: 10.5, type: 'word' }
      ];
      expect(buildSegmentsFromWords(words, { maxGapSec: 1.5 })).toEqual([
        { start: 10, end: 10.5, text: 'kept' }
      ]);
    });

    test('returns an empty array for empty or malformed input', () => {
      expect(buildSegmentsFromWords([])).toEqual([]);
      expect(buildSegmentsFromWords(null as never)).toEqual([]);
      expect(buildSegmentsFromWords(undefined as never)).toEqual([]);
    });

    test('never produces negative timestamps when the offset is negative', () => {
      const words = [{ text: 'clamped', start: 0.1, end: 0.5, type: 'word' }];
      const segments = buildSegmentsFromWords(words, { offsetSec: -1 });
      expect(segments[0].start).toBe(0);
      expect(segments[0].end).toBe(0);
    });

    test('default max gap matches the legacy realtime VAD silence threshold', () => {
      expect(BATCH_SEGMENT_MAX_GAP_SEC).toBe(1.5);
    });
  });

  describe('getTranscriptionTimeoutMs', () => {
    test('short recordings get the minimum timeout', () => {
      expect(getTranscriptionTimeoutMs(10)).toBe(TRANSCRIPTION_TIMEOUT_MIN_MS);
    });

    test('long recordings scale the timeout with duration', () => {
      const fortyMinutes = 40 * 60;
      const timeout = getTranscriptionTimeoutMs(fortyMinutes);
      expect(timeout).toBeGreaterThan(TRANSCRIPTION_TIMEOUT_MIN_MS);
      expect(timeout).toBeLessThanOrEqual(TRANSCRIPTION_TIMEOUT_MAX_MS);
    });

    test('timeout is capped at the maximum', () => {
      expect(getTranscriptionTimeoutMs(100 * 60 * 60)).toBe(TRANSCRIPTION_TIMEOUT_MAX_MS);
    });

    test('malformed durations fall back to the minimum timeout', () => {
      expect(getTranscriptionTimeoutMs(Number.NaN)).toBe(TRANSCRIPTION_TIMEOUT_MIN_MS);
      expect(getTranscriptionTimeoutMs(-5)).toBe(TRANSCRIPTION_TIMEOUT_MIN_MS);
      expect(getTranscriptionTimeoutMs(undefined as never)).toBe(TRANSCRIPTION_TIMEOUT_MIN_MS);
    });
  });
});
