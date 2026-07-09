import { describe, expect, test } from 'vitest';

import {
  resolvePlaybackAdvance,
  type PlaybackAdvance
} from '../../src/renderer/features/timeline/playback-advance';

function expectStatus<T extends PlaybackAdvance['status']>(
  advance: PlaybackAdvance,
  status: T
): Extract<PlaybackAdvance, { status: T }> {
  expect(advance.status).toBe(status);
  if (advance.status !== status) throw new Error(`expected ${status}, got ${advance.status}`);
  return advance as Extract<PlaybackAdvance, { status: T }>;
}

function makeSection(
  id: string,
  takeId: string,
  start: number,
  sourceStart: number,
  sourceEnd: number
) {
  const duration = sourceEnd - sourceStart;
  return {
    id,
    takeId,
    start,
    end: start + duration,
    duration,
    sourceStart,
    sourceEnd
  };
}

// A cut timeline: three speech sections with silence gaps in source time.
const SECTIONS = [
  makeSection('s1', 'take-1', 0, 1.5, 10.0), // timeline 0..8.5
  makeSection('s2', 'take-1', 8.5, 14.0, 20.0), // timeline 8.5..14.5
  makeSection('s3', 'take-1', 14.5, 25.0, 30.0) // timeline 14.5..19.5
];

describe('renderer/features/timeline/playback-advance', () => {
  test('continues within the active section and maps timeline time', () => {
    const advance = expectStatus(
      resolvePlaybackAdvance({ sections: SECTIONS, activeSectionId: 's1', sourceTime: 5.0 }),
      'continue'
    );
    expect(advance.timelineTime).toBeCloseTo(3.5); // 0 + (5.0 - 1.5)
    expect(advance.activeIndex).toBe(0);
  });

  test('crossing a source gap yields a boundary with a seek to the next sourceStart', () => {
    const advance = expectStatus(
      resolvePlaybackAdvance({ sections: SECTIONS, activeSectionId: 's1', sourceTime: 10.0 }),
      'boundary'
    );
    expect(advance.nextSectionId).toBe('s2');
    // Gap between 10.0 and 14.0 in source time → must seek, not continue.
    expect(advance.targetSourceTime).toBe(14.0);
    expect(advance.sameTake).toBe(true);
  });

  test('contiguous same-take sections continue without a seek target jump', () => {
    const contiguous = [
      makeSection('a', 'take-1', 0, 0, 10),
      makeSection('b', 'take-1', 10, 10.02, 20)
    ];
    const advance = expectStatus(
      resolvePlaybackAdvance({ sections: contiguous, activeSectionId: 'a', sourceTime: 10.0 }),
      'boundary'
    );
    expect(advance.nextSectionId).toBe('b');
    // Within contiguity epsilon → keep the running source position.
    expect(advance.targetSourceTime).toBe(10.0);
  });

  test('boundary into a different take always seeks to its sourceStart', () => {
    const multiTake = [
      makeSection('a', 'take-1', 0, 0, 10),
      makeSection('b', 'take-2', 10, 0, 5)
    ];
    const advance = expectStatus(
      resolvePlaybackAdvance({ sections: multiTake, activeSectionId: 'a', sourceTime: 10.0 }),
      'boundary'
    );
    expect(advance.sameTake).toBe(false);
    expect(advance.targetSourceTime).toBe(0);
  });

  test('passing the final section ends playback', () => {
    const advance = expectStatus(
      resolvePlaybackAdvance({ sections: SECTIONS, activeSectionId: 's3', sourceTime: 30.0 }),
      'end'
    );
    expect(advance.timelineTime).toBeCloseTo(19.5);
  });

  test('reports stale when the active section id is no longer on the timeline', () => {
    // The Transcribe & Cut regression: sections were REPLACED with new
    // objects/ids while a stale reference still drove playback. The old
    // indexOf(-1) + 1 logic silently jumped playback to sections[0].
    const advance = resolvePlaybackAdvance({
      sections: SECTIONS,
      activeSectionId: 'old-full-take-section',
      sourceTime: 42.0
    });
    expect(advance.status).toBe('stale');
  });

  test('lookup is id-based so undo/redo object copies keep correct geometry', () => {
    // Simulates restoreSnapshot(): same ids, brand-new objects with different
    // geometry than any stale reference a caller might still hold.
    const copies = SECTIONS.map((s) => ({ ...s }));
    const advance = expectStatus(
      resolvePlaybackAdvance({ sections: copies, activeSectionId: 's2', sourceTime: 15.0 }),
      'continue'
    );
    expect(advance.timelineTime).toBeCloseTo(9.5); // 8.5 + (15.0 - 14.0)
    expect(advance.activeIndex).toBe(1);
  });

  test('respects the boundary epsilon just before a section end', () => {
    const advance = resolvePlaybackAdvance({
      sections: SECTIONS,
      activeSectionId: 's1',
      sourceTime: 9.985 // < sourceEnd - 0.01
    });
    expect(advance.status).toBe('continue');

    const atEpsilon = resolvePlaybackAdvance({
      sections: SECTIONS,
      activeSectionId: 's1',
      sourceTime: 9.995 // >= sourceEnd - 0.01
    });
    expect(atEpsilon.status).toBe('boundary');
  });

  test('handles malformed input defensively', () => {
    expect(
      resolvePlaybackAdvance({ sections: [], activeSectionId: 's1', sourceTime: 0 }).status
    ).toBe('stale');
    expect(
      resolvePlaybackAdvance({
        sections: null as never,
        activeSectionId: 's1',
        sourceTime: 0
      }).status
    ).toBe('stale');
    expect(
      resolvePlaybackAdvance({
        sections: SECTIONS,
        activeSectionId: 's1',
        sourceTime: Number.NaN
      }).status
    ).toBe('stale');
  });
});
