import { describe, expect, test } from 'vitest';

import { buildSegmentsFromWords } from '../../src/renderer/features/transcript/batch-transcript';
import {
  cutRepeatedTakes,
  detectRepeatedTakes,
  mergeSpeechSegments,
  MISTAKE_MAX_INTERJECTION_TOKENS,
  MISTAKE_MAX_RETRY_GAP_SEC,
  MISTAKE_MIN_TOKENS,
  MISTAKE_UTTERANCE_GAP_SEC,
  normalizeComparisonTokens,
  tokenSimilarity
} from '../../src/renderer/features/transcript/mistake-detection';

describe('renderer/features/transcript/mistake-detection', () => {
  describe('normalizeComparisonTokens', () => {
    test('lowercases, strips punctuation, and drops filler words', () => {
      expect(normalizeComparisonTokens("So, in THIS video — um, we're building!")).toEqual([
        'so',
        'in',
        'this',
        'video',
        "we're",
        'building'
      ]);
    });

    test('returns an empty array for empty or non-string input', () => {
      expect(normalizeComparisonTokens('')).toEqual([]);
      expect(normalizeComparisonTokens('   ')).toEqual([]);
      expect(normalizeComparisonTokens(undefined as never)).toEqual([]);
    });
  });

  describe('tokenSimilarity', () => {
    test('identical token lists score 1', () => {
      expect(tokenSimilarity(['a', 'b', 'c'], ['a', 'b', 'c'])).toBe(1);
    });

    test('completely different token lists score 0', () => {
      expect(tokenSimilarity(['a', 'b'], ['x', 'y'])).toBe(0);
    });

    test('a single substitution in five tokens scores 0.8', () => {
      expect(tokenSimilarity(['a', 'b', 'c', 'd', 'e'], ['a', 'b', 'x', 'd', 'e'])).toBeCloseTo(
        0.8
      );
    });

    test('two empty lists are identical', () => {
      expect(tokenSimilarity([], [])).toBe(1);
    });
  });

  describe('detectRepeatedTakes', () => {
    test('flags an exact repeated line and keeps the last take', () => {
      const segments = [
        { start: 0, end: 2.5, text: "So in this video we're building a video editor" },
        { start: 3.5, end: 6.0, text: "So in this video we're building a video editor" }
      ];
      const { removedIndices, removed } = detectRepeatedTakes(segments);
      expect([...removedIndices]).toEqual([0]);
      expect(removed).toHaveLength(1);
      expect(removed[0]).toMatchObject({
        start: 0,
        end: 2.5,
        text: "So in this video we're building a video editor",
        retryText: "So in this video we're building a video editor"
      });
    });

    test('flags an aborted attempt that is a prefix of the retry', () => {
      const segments = [
        { start: 0, end: 1.6, text: "So in this video we're" },
        { start: 2.4, end: 6.0, text: "So in this video we're going to build the editor" }
      ];
      const { removedIndices } = detectRepeatedTakes(segments);
      expect([...removedIndices]).toEqual([0]);
    });

    test('a chain of retries keeps only the final take', () => {
      const line = 'The best way to record a tutorial';
      const segments = [
        { start: 0, end: 2, text: line },
        { start: 3, end: 5, text: line },
        { start: 6, end: 8, text: `${line} is with this app` }
      ];
      const { removedIndices, removed } = detectRepeatedTakes(segments);
      expect([...removedIndices].sort()).toEqual([0, 1]);
      expect(removed).toHaveLength(2);
    });

    test('comparison ignores case, punctuation, and filler words', () => {
      const segments = [
        { start: 0, end: 1.8, text: "In this video, we'll build" },
        { start: 2.6, end: 6.0, text: "um, in this video we'll build something great" }
      ];
      const { removedIndices } = detectRepeatedTakes(segments);
      expect([...removedIndices]).toEqual([0]);
    });

    test('short utterances are never flagged even when repeated', () => {
      const segments = [
        { start: 0, end: 0.6, text: 'Okay so' },
        { start: 1.4, end: 2.0, text: 'Okay so' }
      ];
      const { removedIndices } = detectRepeatedTakes(segments);
      expect(removedIndices.size).toBe(0);
    });

    test('a repeat beyond the retry window is not treated as a retake', () => {
      const line = 'Thanks for watching and see you next time';
      const segments = [
        { start: 0, end: 2, text: line },
        { start: 2 + MISTAKE_MAX_RETRY_GAP_SEC + 0.5, end: 14, text: line }
      ];
      const { removedIndices } = detectRepeatedTakes(segments);
      expect(removedIndices.size).toBe(0);
    });

    test('a short interjection between flub and retry is removed with the flub', () => {
      const segments = [
        { start: 0, end: 1.5, text: 'This is the best part' },
        { start: 2.0, end: 2.5, text: 'Ugh, nope' },
        { start: 3.0, end: 5.0, text: 'This is the best part of the app' }
      ];
      const { removedIndices, removed } = detectRepeatedTakes(segments);
      expect([...removedIndices].sort()).toEqual([0, 1]);
      expect(removed).toHaveLength(1);
      expect(removed[0].end).toBe(2.5);
    });

    test('a long middle utterance blocks the lookahead match', () => {
      const segments = [
        { start: 0, end: 2, text: 'The quick brown fox jumps' },
        { start: 2.5, end: 5, text: 'totally different words spoken here right now' },
        { start: 5.5, end: 8, text: 'The quick brown fox jumps again' }
      ];
      const { removedIndices } = detectRepeatedTakes(segments);
      expect(removedIndices.size).toBe(0);
    });

    test('dissimilar consecutive utterances are untouched', () => {
      const segments = [
        { start: 0, end: 2, text: 'Welcome back to the channel everyone' },
        { start: 3, end: 5, text: 'Today we are looking at something new' }
      ];
      const { removedIndices, removed } = detectRepeatedTakes(segments);
      expect(removedIndices.size).toBe(0);
      expect(removed).toEqual([]);
    });

    test('returns empty results for empty or malformed input', () => {
      expect(detectRepeatedTakes([]).removedIndices.size).toBe(0);
      expect(detectRepeatedTakes(null as never).removed).toEqual([]);
    });
  });

  describe('mergeSpeechSegments', () => {
    test('rejoins kept utterances separated by less than the merge gap', () => {
      const segments = [
        { start: 0, end: 1.0, text: 'First part' },
        { start: 2.0, end: 3.0, text: 'still the same thought' }
      ];
      expect(mergeSpeechSegments(segments, { removedIndices: new Set() })).toEqual([
        { start: 0, end: 3.0, text: 'First part still the same thought' }
      ]);
    });

    test('keeps utterances separate across a real silence', () => {
      const segments = [
        { start: 0, end: 1.0, text: 'First' },
        { start: 3.0, end: 4.0, text: 'Second' }
      ];
      expect(mergeSpeechSegments(segments, { removedIndices: new Set() })).toHaveLength(2);
    });

    test('never merges across a removed take even when the gap is small', () => {
      const segments = [
        { start: 0, end: 1.0, text: 'Welcome back everyone to the channel' },
        { start: 1.4, end: 1.9, text: "let's do this" },
        { start: 2.3, end: 4.0, text: "let's do this properly now" }
      ];
      const merged = mergeSpeechSegments(segments, { removedIndices: new Set([1]) });
      expect(merged).toEqual([
        { start: 0, end: 1.0, text: 'Welcome back everyone to the channel' },
        { start: 2.3, end: 4.0, text: "let's do this properly now" }
      ]);
    });
  });

  describe('cutRepeatedTakes', () => {
    test('removes the flub and reports the removal', () => {
      const line = 'Recording tutorials should be really easy';
      const { segments, removed } = cutRepeatedTakes([
        { start: 0, end: 2, text: line },
        { start: 3, end: 5, text: `${line} for everyone` }
      ]);
      expect(segments).toEqual([{ start: 3, end: 5, text: `${line} for everyone` }]);
      expect(removed).toHaveLength(1);
    });

    test('with no repeats, output matches the direct 1.5s segmentation', () => {
      const words = [
        { text: 'Hello', start: 0.2, end: 0.6, type: 'word' },
        { text: 'there', start: 1.5, end: 1.9, type: 'word' },
        // 1.2s pause: splits fine utterances, but stays one 1.5s segment
        { text: 'friend', start: 3.1, end: 3.5, type: 'word' },
        // real silence
        { text: 'Goodbye', start: 6.0, end: 6.5, type: 'word' }
      ];
      const fine = buildSegmentsFromWords(words, { maxGapSec: MISTAKE_UTTERANCE_GAP_SEC });
      const { segments, removed } = cutRepeatedTakes(fine);
      expect(removed).toEqual([]);
      expect(segments).toEqual(buildSegmentsFromWords(words, { maxGapSec: 1.5 }));
    });

    test('returns empty output for empty input', () => {
      expect(cutRepeatedTakes([])).toEqual({ segments: [], removed: [] });
    });
  });

  describe('tuning constants', () => {
    test('defaults match the documented behavior', () => {
      expect(MISTAKE_UTTERANCE_GAP_SEC).toBe(0.5);
      expect(MISTAKE_MIN_TOKENS).toBe(3);
      expect(MISTAKE_MAX_RETRY_GAP_SEC).toBe(8);
      expect(MISTAKE_MAX_INTERJECTION_TOKENS).toBe(4);
    });
  });
});
