import { describe, expect, test } from 'vitest';

import { resolveScrubSeekAction } from '../../src/renderer/features/timeline/scrub-seek-policy';

describe('renderer/features/timeline/scrub-seek-policy', () => {
  test('commits the first decoder seek then bounds pointer-move seeks', () => {
    expect(
      resolveScrubSeekAction({
        nowMs: 100,
        lastMediaSeekAtMs: null,
        intervalMs: 50,
        final: false
      })
    ).toEqual({ commitMediaSeek: true, nextLastMediaSeekAtMs: 100 });

    expect(
      resolveScrubSeekAction({
        nowMs: 125,
        lastMediaSeekAtMs: 100,
        intervalMs: 50,
        final: false
      })
    ).toEqual({ commitMediaSeek: false, nextLastMediaSeekAtMs: 100 });

    expect(
      resolveScrubSeekAction({
        nowMs: 151,
        lastMediaSeekAtMs: 100,
        intervalMs: 50,
        final: false
      })
    ).toEqual({ commitMediaSeek: true, nextLastMediaSeekAtMs: 151 });
  });

  test('always commits the exact release seek', () => {
    expect(
      resolveScrubSeekAction({
        nowMs: 130,
        lastMediaSeekAtMs: 100,
        intervalMs: 50,
        final: true
      })
    ).toEqual({ commitMediaSeek: true, nextLastMediaSeekAtMs: 130 });
  });
});
