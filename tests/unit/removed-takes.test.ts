import { describe, expect, test } from 'vitest';

import {
  buildRestoredSectionBounds,
  buildTranscriptViewEntries,
  deriveRemovedTakeSegments,
  dropSilentSliverSections,
  remapTakeLocalPositions,
  removeSourceRangesFromSections,
  transcriptTextForRange
} from '../../src/renderer/features/transcript/removed-takes';

let idCounter = 0;
function makeTestId() {
  idCounter += 1;
  return `new-${idCounter}`;
}

function sectionStub(overrides: Record<string, unknown> = {}) {
  return {
    id: 'section-1',
    index: 0,
    label: 'Section 1',
    start: 0,
    end: 1,
    duration: 1,
    sourceStart: 0,
    sourceEnd: 1,
    takeId: 'take-1',
    transcript: '',
    imagePath: null,
    ...overrides
  };
}

describe('transcriptTextForRange', () => {
  test('joins text of segments overlapping the range in order', () => {
    const segments = [
      { start: 0, end: 1, text: 'hello' },
      { start: 2, end: 3, text: 'cut me' },
      { start: 3.2, end: 4, text: 'me too' },
      { start: 6, end: 7, text: 'outside' }
    ];
    expect(transcriptTextForRange(segments, 1.5, 5)).toBe('cut me me too');
  });

  test('ignores segments with only trivial overlap and normalizes whitespace', () => {
    const segments = [
      { start: 0, end: 2, text: '  kept   speech ' },
      { start: 1.99, end: 4, text: 'barely touches' }
    ];
    expect(transcriptTextForRange(segments, 0, 2)).toBe('kept speech');
  });

  test('returns empty string for empty or invalid input', () => {
    expect(transcriptTextForRange([], 0, 5)).toBe('');
    expect(transcriptTextForRange(null as never, 0, 5)).toBe('');
    expect(transcriptTextForRange([{ start: Number.NaN, end: 1, text: 'x' }], 0, 5)).toBe('');
  });
});

describe('deriveRemovedTakeSegments', () => {
  test('returns uncovered spoken utterances grouped across small gaps', () => {
    const removed = deriveRemovedTakeSegments({
      sections: [
        { sourceStart: 0.85, sourceEnd: 2.15 },
        { sourceStart: 5.85, sourceEnd: 8.15 }
      ],
      utterances: [
        { start: 1, end: 2, text: 'hello' },
        { start: 3, end: 4, text: 'flub one' },
        { start: 4.5, end: 5.5, text: 'flub two' },
        { start: 6, end: 8, text: 'final take' }
      ]
    });

    expect(removed).toEqual([{ start: 3, end: 5.5, text: 'flub one flub two' }]);
  });

  test('a kept utterance between removed ones breaks the group', () => {
    const removed = deriveRemovedTakeSegments({
      sections: [{ sourceStart: 3.85, sourceEnd: 6.15 }],
      utterances: [
        { start: 1, end: 2, text: 'first flub' },
        { start: 4, end: 6, text: 'kept' },
        { start: 7, end: 8, text: 'second flub' }
      ]
    });

    expect(removed).toEqual([
      { start: 1, end: 2, text: 'first flub' },
      { start: 7, end: 8, text: 'second flub' }
    ]);
  });

  test('mostly covered utterances are not treated as removed', () => {
    const removed = deriveRemovedTakeSegments({
      sections: [{ sourceStart: 0, sourceEnd: 3.9 }],
      utterances: [{ start: 3, end: 4, text: 'trimmed a little' }]
    });
    expect(removed).toEqual([]);
  });

  test('barely covered utterances are treated as removed', () => {
    const removed = deriveRemovedTakeSegments({
      sections: [{ sourceStart: 0, sourceEnd: 3.1 }],
      utterances: [{ start: 3, end: 4, text: 'nearly all gone' }]
    });
    expect(removed).toEqual([{ start: 3, end: 4, text: 'nearly all gone' }]);
  });

  test('utterances without text and invalid input are ignored', () => {
    expect(
      deriveRemovedTakeSegments({
        sections: [],
        utterances: [
          { start: 1, end: 2, text: '' },
          { start: 3, end: Number.NaN, text: 'invalid' }
        ]
      })
    ).toEqual([]);
    expect(deriveRemovedTakeSegments({ sections: null, utterances: null })).toEqual([]);
  });
});

describe('removeSourceRangesFromSections', () => {
  test('splits a section around a removed range, snapping cut edges to speech', () => {
    const section = sectionStub({
      id: 'orig',
      sourceStart: 0,
      sourceEnd: 10,
      transcript: 'hello flubbed take retry'
    });
    const utterances = [
      { start: 1, end: 3, text: 'hello' },
      { start: 4, end: 6, text: 'flubbed take' },
      { start: 7, end: 9, text: 'retry' }
    ];

    const result = removeSourceRangesFromSections({
      sections: [section],
      ranges: [{ start: 4, end: 6 }],
      utterances,
      makeId: makeTestId
    });

    expect(result.changed).toBe(true);
    expect(result.sections).toHaveLength(2);
    const [left, right] = result.sections;
    expect(left.id).toBe('orig');
    // The original left edge stays; the cut-created right edge snaps to the
    // last word before the flub plus padding, not the padded removal edge.
    expect(left.sourceStart).toBe(0);
    expect(left.sourceEnd).toBeCloseTo(3.15, 3);
    expect(left.transcript).toBe('hello');
    expect(right.id).toMatch(/^new-/);
    // The cut-created left edge snaps to the retry's first word minus
    // padding, so the piece no longer opens with the pause before the retry.
    expect(right.sourceStart).toBeCloseTo(6.85, 3);
    expect(right.sourceEnd).toBe(10);
    expect(right.transcript).toBe('retry');
  });

  test('drops silent slivers left between two removed flubs', () => {
    const section = sectionStub({ id: 'orig', sourceStart: 0, sourceEnd: 12 });
    const utterances = [
      { start: 0.2, end: 2.8, text: 'first flub' },
      { start: 5, end: 7.8, text: 'second flub' },
      { start: 9, end: 11.5, text: 'the good retry' }
    ];

    const result = removeSourceRangesFromSections({
      sections: [section],
      ranges: [
        { start: 0.2, end: 2.8 },
        { start: 5, end: 7.8 }
      ],
      utterances,
      makeId: makeTestId
    });

    // The wordless pause between the flubs (2.95–4.85) must not survive as
    // its own silent section; only the retry piece remains, snapped to its
    // first word.
    expect(result.sections).toHaveLength(1);
    expect(result.sections[0].sourceStart).toBeCloseTo(8.85, 3);
    expect(result.sections[0].sourceEnd).toBe(12);
  });

  test('keeps a wordless piece whose other edge is an original section boundary', () => {
    // Mic-silent content at the section start (e.g. screen audio) with a
    // flub at the end: the leading piece keeps its original left edge and,
    // having no words to snap to, its cut right edge stays conservative.
    const section = sectionStub({ id: 'orig', sourceStart: 0, sourceEnd: 8 });
    const utterances = [{ start: 5, end: 7.9, text: 'a flubbed line' }];

    const result = removeSourceRangesFromSections({
      sections: [section],
      ranges: [{ start: 5, end: 7.9 }],
      utterances,
      makeId: makeTestId
    });

    expect(result.sections).toHaveLength(1);
    expect(result.sections[0].sourceStart).toBe(0);
    expect(result.sections[0].sourceEnd).toBeCloseTo(4.85, 3);
  });

  test('snapToProtected=false keeps plain padded removal bounds and drops nothing', () => {
    const section = sectionStub({ id: 'orig', sourceStart: 0, sourceEnd: 10 });
    const utterances = [
      { start: 1, end: 3, text: 'hello' },
      { start: 4, end: 6, text: 'flubbed take' },
      { start: 7, end: 9, text: 'retry' }
    ];

    const result = removeSourceRangesFromSections({
      sections: [section],
      ranges: [{ start: 4, end: 6 }],
      utterances,
      makeId: makeTestId,
      snapToProtected: false
    });

    expect(result.sections).toHaveLength(2);
    expect(result.sections[0].sourceEnd).toBeCloseTo(3.85, 3);
    expect(result.sections[1].sourceStart).toBeCloseTo(6.15, 3);
  });

  test('protected ranges (system audio) shield and bound wordless pieces', () => {
    const section = sectionStub({ id: 'orig', sourceStart: 0, sourceEnd: 12 });
    const utterances = [
      { start: 0.2, end: 2.8, text: 'first flub' },
      { start: 8, end: 11.5, text: 'the good retry' }
    ];

    const result = removeSourceRangesFromSections({
      sections: [section],
      ranges: [
        { start: 0.2, end: 2.8 },
        { start: 6, end: 7 }
      ],
      utterances,
      // Screen audio played between the removed ranges — the piece between
      // two cuts must survive, snapped to the audio bounds.
      protectedRanges: [...utterances, { start: 3.5, end: 5.2, text: '' }],
      makeId: makeTestId
    });

    expect(result.sections).toHaveLength(2);
    expect(result.sections[0].sourceStart).toBeCloseTo(3.35, 3);
    expect(result.sections[0].sourceEnd).toBeCloseTo(5.35, 3);
    expect(result.sections[1].sourceStart).toBeCloseTo(7.85, 3);
  });

  test('drops sections fully inside a removed range and keeps untouched sections identical', () => {
    const untouched = sectionStub({ id: 'keep', sourceStart: 0, sourceEnd: 3 });
    const doomed = sectionStub({ id: 'gone', index: 1, sourceStart: 4, sourceEnd: 6 });

    const result = removeSourceRangesFromSections({
      sections: [untouched, doomed],
      ranges: [{ start: 3.9, end: 6.1 }],
      utterances: [],
      makeId: makeTestId
    });

    expect(result.changed).toBe(true);
    expect(result.sections).toHaveLength(1);
    expect(result.sections[0]).toBe(untouched);
  });

  test('drops sliver remainders shorter than the minimum keep duration', () => {
    const section = sectionStub({ id: 'orig', sourceStart: 0, sourceEnd: 5 });
    const result = removeSourceRangesFromSections({
      sections: [section],
      ranges: [{ start: 0.2, end: 5 }],
      utterances: [],
      makeId: makeTestId
    });

    // Left remainder would be ~0.05s after padding — dropped entirely.
    expect(result.changed).toBe(true);
    expect(result.sections).toHaveLength(0);
  });

  test('reports changed=false when no range overlaps the sections', () => {
    const section = sectionStub({ sourceStart: 0, sourceEnd: 2 });
    const result = removeSourceRangesFromSections({
      sections: [section],
      ranges: [{ start: 8, end: 9 }],
      utterances: [],
      makeId: makeTestId
    });

    expect(result.changed).toBe(false);
    expect(result.sections).toHaveLength(1);
    expect(result.sections[0]).toBe(section);
  });

  test('merges overlapping removed ranges before subtracting', () => {
    const section = sectionStub({ id: 'orig', sourceStart: 0, sourceEnd: 10 });
    const result = removeSourceRangesFromSections({
      sections: [section],
      ranges: [
        { start: 2, end: 4 },
        { start: 3.5, end: 6 }
      ],
      utterances: [],
      makeId: makeTestId
    });

    expect(result.sections).toHaveLength(2);
    expect(result.sections[0].sourceEnd).toBeCloseTo(1.85, 3);
    expect(result.sections[1].sourceStart).toBeCloseTo(6.15, 3);
  });
});

describe('dropSilentSliverSections', () => {
  const protectedRanges = [
    { start: 1, end: 3, text: 'speech' },
    { start: 10, end: 12, text: '' } // system audio
  ];

  test('drops short sections containing no speech and no protected audio', () => {
    const sections = [
      sectionStub({ id: 'talk', sourceStart: 0.85, sourceEnd: 3.15 }),
      sectionStub({ id: 'sliver', index: 1, sourceStart: 4, sourceEnd: 4.9 }),
      sectionStub({ id: 'audio', index: 2, sourceStart: 9.8, sourceEnd: 12.2 })
    ];
    const result = dropSilentSliverSections({ sections, protectedRanges });
    expect(result.droppedCount).toBe(1);
    expect(result.sections.map((s) => s.id)).toEqual(['talk', 'audio']);
    // Untouched sections keep identity.
    expect(result.sections[0]).toBe(sections[0]);
  });

  test('keeps long silent sections — a deliberate pause is not a sliver', () => {
    const sections = [
      sectionStub({ id: 'long-pause', sourceStart: 4, sourceEnd: 7.5 })
    ];
    const result = dropSilentSliverSections({ sections, protectedRanges });
    expect(result.droppedCount).toBe(0);
    expect(result.sections).toHaveLength(1);
  });

  test('handles invalid input', () => {
    expect(dropSilentSliverSections({ sections: null, protectedRanges }).sections).toEqual([]);
    expect(
      dropSilentSliverSections({ sections: [], protectedRanges: null }).droppedCount
    ).toBe(0);
  });
});

describe('buildRestoredSectionBounds', () => {
  test('returns the padded range clamped against neighboring sections', () => {
    const bounds = buildRestoredSectionBounds({
      range: { start: 4, end: 6 },
      sections: [
        { sourceStart: 0, sourceEnd: 3.85 },
        { sourceStart: 6.15, sourceEnd: 10 }
      ],
      takeDuration: 10
    });
    expect(bounds).toEqual({ sourceStart: 3.85, sourceEnd: 6.15 });
  });

  test('clamps to the take bounds when there are no neighbors', () => {
    const bounds = buildRestoredSectionBounds({
      range: { start: 0.05, end: 9.95 },
      sections: [],
      takeDuration: 10
    });
    expect(bounds).toEqual({ sourceStart: 0, sourceEnd: 10 });
  });

  test('returns null when the range is already covered by a section', () => {
    const bounds = buildRestoredSectionBounds({
      range: { start: 4, end: 6 },
      sections: [{ sourceStart: 3, sourceEnd: 7 }],
      takeDuration: 10
    });
    expect(bounds).toBeNull();
  });

  test('returns null for invalid input', () => {
    expect(
      buildRestoredSectionBounds({
        range: { start: Number.NaN, end: 6 },
        sections: [],
        takeDuration: 10
      })
    ).toBeNull();
  });
});

describe('remapTakeLocalPositions', () => {
  test('sorts by source position and lays sections end to end from zero', () => {
    const remapped = remapTakeLocalPositions([
      sectionStub({ id: 'b', sourceStart: 6, sourceEnd: 9 }),
      sectionStub({ id: 'a', sourceStart: 1, sourceEnd: 3 })
    ]);

    expect(remapped.map((s) => s.id)).toEqual(['a', 'b']);
    expect(remapped[0]).toMatchObject({ start: 0, end: 2, duration: 2, index: 0 });
    expect(remapped[1]).toMatchObject({ start: 2, end: 5, duration: 3, index: 1 });
    expect(remapped[1].label).toBe('Section 2');
  });

  test('returns empty array for invalid input', () => {
    expect(remapTakeLocalPositions(null)).toEqual([]);
  });
});

describe('buildTranscriptViewEntries', () => {
  test('returns only section entries when no removed segments are provided', () => {
    const sections = [sectionStub(), sectionStub({ id: 'section-2', index: 1 })];
    const entries = buildTranscriptViewEntries({ sections, removedByTake: new Map() });
    expect(entries.map((entry) => entry.kind)).toEqual(['section', 'section']);
  });

  test('interleaves removed segments between sections of the same take by source position', () => {
    const sections = [
      sectionStub({ id: 's1', sourceStart: 1, sourceEnd: 3, start: 0, end: 2 }),
      sectionStub({ id: 's2', index: 1, sourceStart: 6, sourceEnd: 9, start: 2, end: 5 })
    ];
    const removedByTake = new Map([
      [
        'take-1',
        [
          { start: 3.5, end: 5.5, text: 'flubbed take' },
          { start: 9.2, end: 10, text: 'trailing' }
        ]
      ]
    ]);

    const entries = buildTranscriptViewEntries({ sections, removedByTake });
    expect(
      entries.map((entry) =>
        entry.kind === 'section' ? entry.section.id : `removed:${entry.removed.text}`
      )
    ).toEqual(['s1', 'removed:flubbed take', 's2', 'removed:trailing']);
  });

  test('keeps takes independent when the timeline mixes them', () => {
    const sections = [
      sectionStub({ id: 'a1', takeId: 'take-a', sourceStart: 0, sourceEnd: 4 }),
      sectionStub({ id: 'b1', index: 1, takeId: 'take-b', sourceStart: 0, sourceEnd: 3 }),
      sectionStub({ id: 'b2', index: 2, takeId: 'take-b', sourceStart: 5, sourceEnd: 8 })
    ];
    const removedByTake = new Map([
      ['take-a', [{ start: 4.2, end: 6, text: 'tail of take a' }]],
      ['take-b', [{ start: 3.5, end: 4.5, text: 'middle of take b' }]]
    ]);

    const entries = buildTranscriptViewEntries({ sections, removedByTake });
    const labels = entries.map((entry) =>
      entry.kind === 'section' ? entry.section.id : `removed:${entry.removed.text}`
    );
    expect(labels).toEqual([
      'a1',
      'removed:tail of take a',
      'b1',
      'removed:middle of take b',
      'b2'
    ]);
  });
});
