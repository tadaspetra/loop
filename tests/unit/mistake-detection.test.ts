import { describe, expect, test } from 'vitest';

import { buildSegmentsFromWords } from '../../src/renderer/features/transcript/batch-transcript';
import {
  cutRepeatedTakes,
  detectRepeatedTakes,
  mergeSpeechSegments,
  MISTAKE_MAX_RETRY_GAP_SEC,
  MISTAKE_MIN_CONTINUATION_TOKENS,
  MISTAKE_MIN_TOKENS,
  MISTAKE_UTTERANCE_GAP_SEC,
  normalizeComparisonTokens
} from '../../src/renderer/features/transcript/mistake-detection';
import { buildRecordingSectionsForTimeline } from '../../src/renderer/features/timeline/section-utils';

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

  describe('detectRepeatedTakes', () => {
    test('removes an abandoned multi-word prefix immediately restarted with continuation', () => {
      const segments = [
        { start: 0, end: 1.6, text: "So in this video we're" },
        { start: 2.4, end: 6.0, text: "So in this video we're going to build the editor" }
      ];
      const { removedIndices, removed } = detectRepeatedTakes(segments);
      expect([...removedIndices]).toEqual([0]);
      expect(removed).toHaveLength(1);
      expect(removed[0]).toMatchObject({
        start: 0,
        end: 1.6,
        text: "So in this video we're",
        retryText: "So in this video we're going to build the editor"
      });
    });

    test('keeps an exact full sentence repeated after a short pause', () => {
      const line = "So in this video we're building a video editor.";
      const segments = [
        { start: 0, end: 2.5, text: line },
        { start: 3.2, end: 5.7, text: line }
      ];
      const { removedIndices } = detectRepeatedTakes(segments);
      expect(removedIndices.size).toBe(0);
    });

    test('keeps deliberate full-sentence emphasis repeated several times before an addition', () => {
      const line = 'Never overwrite the original recording.';
      const segments = [
        { start: 0, end: 1.8, text: line },
        { start: 2.5, end: 4.3, text: line },
        { start: 5, end: 6.8, text: line },
        { start: 7.5, end: 10.5, text: `${line} Keep every source file immutable.` }
      ];

      expect(detectRepeatedTakes(segments).removedIndices.size).toBe(0);
    });

    test('keeps a complete thought repeated with a meaningful addition', () => {
      const segments = [
        { start: 0, end: 2.0, text: 'The key idea is simple.' },
        { start: 2.7, end: 5.5, text: 'The key idea is simple. It also scales to larger projects.' }
      ];
      const { removedIndices } = detectRepeatedTakes(segments);
      expect(removedIndices.size).toBe(0);
    });

    test('keeps repeated one or two common words even when the second utterance continues', () => {
      const segments = [
        { start: 0, end: 0.5, text: 'You know' },
        { start: 1.1, end: 2.8, text: 'you know this happens often' }
      ];
      const { removedIndices } = detectRepeatedTakes(segments);
      expect(removedIndices.size).toBe(0);
    });

    test('keeps a vague common opening even when it has four tokens', () => {
      const segments = [
        { start: 0, end: 0.8, text: 'This is what we' },
        { start: 1.5, end: 3.0, text: 'this is what we need to discuss today' }
      ];
      const { removedIndices } = detectRepeatedTakes(segments);
      expect(removedIndices.size).toBe(0);
    });

    test('keeps the same opening when the earlier wording meaningfully diverges', () => {
      const segments = [
        { start: 0, end: 2.0, text: 'Today we will ship the desktop editor' },
        { start: 2.7, end: 5.5, text: 'Today we will ship the mobile editor with sync' }
      ];
      const { removedIndices } = detectRepeatedTakes(segments);
      expect(removedIndices.size).toBe(0);
    });

    test('keeps a repeated phrase after a long pause', () => {
      const prefix = 'The quick brown fox jumps';
      const segments = [
        { start: 0, end: 2, text: prefix },
        {
          start: 2 + MISTAKE_MAX_RETRY_GAP_SEC + 0.1,
          end: 7,
          text: `${prefix} over the fence today`
        }
      ];
      const { removedIndices } = detectRepeatedTakes(segments);
      expect(removedIndices.size).toBe(0);
    });

    test('keeps a repeated phrase when any intervening speech exists', () => {
      const segments = [
        { start: 0, end: 1.5, text: 'This is the best part' },
        { start: 2.0, end: 2.5, text: 'Let me clarify that' },
        { start: 3.0, end: 5.0, text: 'This is the best part of the app' }
      ];
      const { removedIndices } = detectRepeatedTakes(segments);
      expect(removedIndices.size).toBe(0);
    });

    test('does not bridge a tiny unrelated interjection to find a later repeat', () => {
      const segments = [
        { start: 0, end: 1.5, text: 'This is the best part' },
        { start: 2.2, end: 2.4, text: 'No' },
        { start: 3.1, end: 5.0, text: 'This is the best part of the application' }
      ];

      expect(detectRepeatedTakes(segments).removedIndices.size).toBe(0);
    });

    test('ignores punctuation, case, and fillers only for a high-confidence restart', () => {
      const segments = [
        { start: 0, end: 1.8, text: "IN this video, um, we'll build—" },
        { start: 2.6, end: 6.0, text: "uh, in this video we'll build a faster editor today." }
      ];
      const { removedIndices } = detectRepeatedTakes(segments);
      expect([...removedIndices]).toEqual([0]);
    });

    test('keeps an apparent restart when filler differences are excessive', () => {
      const segments = [
        { start: 0, end: 1.8, text: "In this video um uh erm we'll build" },
        { start: 2.6, end: 6.0, text: "in this video we'll build a faster editor today" }
      ];
      const { removedIndices } = detectRepeatedTakes(segments);
      expect(removedIndices.size).toBe(0);
    });

    test('keeps complete repeated emphasis, list items, and quoted lines', () => {
      const cases = [
        [
          { start: 0, end: 1.2, text: 'This really matters!' },
          { start: 1.9, end: 3.5, text: 'This really matters! Please remember it.' }
        ],
        [
          { start: 0, end: 1.5, text: 'First, back up the project.' },
          { start: 2.2, end: 4.5, text: 'First, back up the project. Second, update the app.' }
        ],
        [
          { start: 0, end: 1.5, text: '"Never discard the source."' },
          { start: 2.2, end: 4.5, text: '"Never discard the source." That is our rule.' }
        ]
      ];

      for (const segments of cases) {
        expect(detectRepeatedTakes(segments).removedIndices.size).toBe(0);
      }
    });

    test('keeps unpunctuated complete thoughts, lists, and quotes when the next speech adds more', () => {
      const cases = [
        [
          { start: 0, end: 1.2, text: 'The core workflow remains stable' },
          {
            start: 1.9,
            end: 3.5,
            text: 'The core workflow remains stable across longer recordings'
          }
        ],
        [
          { start: 0, end: 1.5, text: 'First back up the project' },
          {
            start: 2.2,
            end: 4.5,
            text: 'First back up the project then update the application'
          }
        ],
        [
          { start: 0, end: 1.5, text: '"Never discard the source"' },
          {
            start: 2.2,
            end: 4.5,
            text: '"Never discard the source" is the rule we follow'
          }
        ]
      ];

      for (const segments of cases) {
        expect(detectRepeatedTakes(segments).removedIndices.size).toBe(0);
      }
    });

    test('keeps matching text when timestamps are malformed or overlap', () => {
      const retry = 'Recording tutorials should be really easy for everyone';
      const cases = [
        [
          { start: 0, end: Number.NaN, text: 'Recording tutorials should be really' },
          { start: 2.5, end: 5, text: retry }
        ],
        [
          { start: 0, end: 2, text: 'Recording tutorials should be really' },
          { start: 1.9, end: 5, text: retry }
        ]
      ];

      for (const segments of cases) {
        expect(detectRepeatedTakes(segments).removedIndices.size).toBe(0);
      }
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
    test('collapses the Scribe multi-attempt staircase to the final complete take', () => {
      const opening = "Today we're launching the ElevenLabs hosted MCP server.";
      const finalTake =
        `${opening} It's a remote MCP server that connects to your assistant, like Claude, ` +
        'to your ElevenLabs workspace, so it can create, configure, and manage your agents all through conversation.';
      const scribeUtterances = [
        { start: 0.2, end: 2.4, text: opening },
        { start: 3.1, end: 4.8, text: "Today we're launching the ElevenLabs" },
        { start: 5.5, end: 5.7, text: 'To-' },
        { start: 6.4, end: 10, text: `${opening} It's a remote MCP server.` },
        {
          start: 10.7,
          end: 18,
          text: `${opening} It's a remote MCP server that connects to your assistant, like Claude.`
        },
        {
          start: 18.7,
          end: 29,
          text:
            `${opening} It's a remote MCP server that connects to your assistant, like Claude, ` +
            'to your ElevenLabs workspace.'
        },
        { start: 29.7, end: 42.2, text: finalTake }
      ];

      const { segments, removed } = cutRepeatedTakes(scribeUtterances);
      const sections = buildRecordingSectionsForTimeline({
        recordedDuration: 42,
        activeSegments: segments
      });

      expect(removed.map((take) => take.text)).toEqual(
        scribeUtterances.slice(0, -1).map(({ text }) => text)
      );
      expect(segments).toEqual([{ start: 29.7, end: 42.2, text: finalTake }]);
      expect(sections).toHaveLength(1);
      expect(sections[0].transcript).toBe(finalTake);
      expect(sections[0].sourceStart).toBeGreaterThanOrEqual(0);
      expect(sections[0].sourceStart).toBeLessThan(sections[0].sourceEnd);
      expect(sections[0].sourceEnd).toBe(42);
      expect(sections[0].start).toBeLessThan(sections[0].end);
    });

    test('classifies a high-confidence restart from deterministic word timestamps', () => {
      const firstWords = ['Recording', 'tutorials', 'should', 'be', 'really'];
      const retryWords = [...firstWords, 'easy', 'for', 'everyone'];
      const words = [
        ...firstWords.map((text, index) => ({
          text,
          start: index * 0.2,
          end: index * 0.2 + 0.15,
          type: 'word'
        })),
        ...retryWords.map((text, index) => ({
          text,
          start: 1.8 + index * 0.2,
          end: 1.8 + index * 0.2 + 0.15,
          type: 'word'
        }))
      ];
      const utterances = buildSegmentsFromWords(words, {
        maxGapSec: MISTAKE_UTTERANCE_GAP_SEC
      });

      const result = cutRepeatedTakes(utterances);

      expect(result.removed).toHaveLength(1);
      expect(result.segments).toEqual([
        {
          start: 1.8,
          end: 3.35,
          text: 'Recording tutorials should be really easy for everyone'
        }
      ]);
    });

    test('removes the flub and reports the removal', () => {
      const line = 'Recording tutorials should be really';
      const { segments, removed } = cutRepeatedTakes([
        { start: 0, end: 2, text: line },
        { start: 3, end: 5, text: `${line} easy for everyone` }
      ]);
      expect(segments).toEqual([{ start: 3, end: 5, text: `${line} easy for everyone` }]);
      expect(removed).toHaveLength(1);
    });

    test('produces monotonic non-overlapping sections within the take duration', () => {
      const takeDuration = 10;
      const { segments } = cutRepeatedTakes([
        { start: 0.2, end: 1.8, text: 'Recording tutorials should be really' },
        {
          start: 2.5,
          end: 5.2,
          text: 'Recording tutorials should be really easy for everyone'
        },
        { start: 8.0, end: 9.95, text: 'Thanks for watching today' }
      ]);
      const sections = buildRecordingSectionsForTimeline({
        recordedDuration: takeDuration,
        activeSegments: segments
      });

      expect(sections.length).toBeGreaterThan(0);
      for (let index = 0; index < sections.length; index += 1) {
        const section = sections[index];
        expect(section.sourceStart).toBeGreaterThanOrEqual(0);
        expect(section.sourceEnd).toBeLessThanOrEqual(takeDuration);
        expect(section.sourceStart).toBeLessThan(section.sourceEnd);
        expect(section.start).toBeLessThan(section.end);
        if (index > 0) {
          expect(section.sourceStart).toBeGreaterThanOrEqual(sections[index - 1].sourceEnd);
          expect(section.start).toBeGreaterThanOrEqual(sections[index - 1].end);
        }
      }
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
      expect(MISTAKE_MIN_TOKENS).toBe(4);
      expect(MISTAKE_MIN_CONTINUATION_TOKENS).toBe(2);
      expect(MISTAKE_MAX_RETRY_GAP_SEC).toBe(1.5);
    });
  });
});
