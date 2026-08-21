import { describe, expect, test } from 'vitest';

import {
  buildRetakeChunks,
  isWordLevelTranscript,
  mapLlmRemovalsToRanges
} from '../../src/renderer/features/transcript/retake-chunks';

/** Spreads a sentence into per-word segments, contiguous from `start`. */
function wordSegments(text: string, start: number, wordDuration = 0.3) {
  return text.split(/\s+/).map((word, index) => ({
    start: start + index * wordDuration,
    end: start + (index + 1) * wordDuration,
    text: word
  }));
}

describe('buildRetakeChunks', () => {
  test('splits at sentence boundaries with word-precise times', () => {
    const words = wordSegments('And it works perfectly. Now the settings page opens.', 10);
    const chunks = buildRetakeChunks(words);

    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toMatchObject({
      index: 0,
      start: 10,
      end: words[3].end,
      text: 'And it works perfectly.'
    });
    expect(chunks[1]).toMatchObject({
      index: 1,
      start: words[4].start,
      text: 'Now the settings page opens.'
    });
  });

  test('splits after cutoff markers and at pauses', () => {
    const flub = wordSegments('Now the settings s--', 0);
    const retry = wordSegments('Now the settings page opens', flub[flub.length - 1].end + 2);
    const chunks = buildRetakeChunks([...flub, ...retry]);

    expect(chunks.map((chunk) => chunk.text)).toEqual([
      'Now the settings s--',
      'Now the settings page opens'
    ]);
    expect(chunks[0].gapAfterSec).toBeCloseTo(2, 5);
    expect(chunks[1].gapAfterSec).toBe(0);
  });

  test('returns empty for invalid input', () => {
    expect(buildRetakeChunks(null)).toEqual([]);
    expect(buildRetakeChunks([{ start: Number.NaN, end: 1, text: 'x' }])).toEqual([]);
  });
});

describe('isWordLevelTranscript', () => {
  test('true for per-word segments', () => {
    expect(isWordLevelTranscript(wordSegments('you can now use the command line', 0))).toBe(true);
  });

  test('false for coarse utterance segments from older projects', () => {
    expect(
      isWordLevelTranscript([
        { start: 0, end: 4, text: 'You can now use the CLI directly. For example...' },
        { start: 5, end: 9, text: 'You can now use ElevenLabs from the command line.' }
      ])
    ).toBe(false);
  });

  test('false for empty or invalid input', () => {
    expect(isWordLevelTranscript([])).toBe(false);
    expect(isWordLevelTranscript(null)).toBe(false);
  });
});

describe('mapLlmRemovalsToRanges', () => {
  const chunks = [
    { index: 0, start: 0, end: 2, text: 'first attempt--', gapAfterSec: 1 },
    { index: 1, start: 3, end: 5, text: 'second attempt--', gapAfterSec: 1 },
    { index: 2, start: 6, end: 10, text: 'the good final take.', gapAfterSec: 0 }
  ];

  test('maps valid indices to chunk time ranges', () => {
    const ranges = mapLlmRemovalsToRanges({ chunks, removedIndices: [1, 0] });
    expect(ranges).toEqual([
      { start: 0, end: 2, text: 'first attempt--' },
      { start: 3, end: 5, text: 'second attempt--' }
    ]);
  });

  test('never removes the final chunk and drops invalid indices', () => {
    const ranges = mapLlmRemovalsToRanges({
      chunks,
      removedIndices: [2, 0, 99, -1, 1.5, Number.NaN]
    });
    expect(ranges).toEqual([{ start: 0, end: 2, text: 'first attempt--' }]);
  });

  test('handles invalid input', () => {
    expect(mapLlmRemovalsToRanges({ chunks: [], removedIndices: [0] })).toEqual([]);
    expect(mapLlmRemovalsToRanges({ chunks, removedIndices: null })).toEqual([]);
  });
});
