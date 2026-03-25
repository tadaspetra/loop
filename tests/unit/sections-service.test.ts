import { describe, expect, test } from 'vitest';

import { computeSections } from '../../src/main/services/sections-service';

describe('main/services/sections-service', () => {
  test('returns empty result for empty segments', () => {
    expect(computeSections({ segments: [] })).toEqual({ sections: [], trimmedDuration: 0 });
  });

  test('pads and merges overlapping segments', () => {
    const result = computeSections({
      paddingSeconds: 0.1,
      segments: [
        { start: 1, end: 2 },
        { start: 2.05, end: 3 }
      ]
    });

    expect(result.sections).toHaveLength(1);
    expect(result.sections[0].sourceStart).toBeCloseTo(0.9, 3);
    expect(result.sections[0].sourceEnd).toBeCloseTo(3.1, 3);
    expect(result.trimmedDuration).toBeCloseTo(2.2, 3);
  });
});
