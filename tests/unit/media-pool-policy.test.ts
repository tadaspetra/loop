import { describe, expect, test } from 'vitest';

import { getWarmTakeIds } from '../../src/renderer/features/timeline/media-pool-policy';

describe('renderer/features/timeline/media-pool-policy', () => {
  test('keeps only the active take and immediate next distinct take warm', () => {
    const sections = [
      { id: 'a', takeId: 'take-1' },
      { id: 'b', takeId: 'take-1' },
      { id: 'c', takeId: 'take-2' },
      { id: 'd', takeId: 'take-3' }
    ];

    expect(getWarmTakeIds(sections, 'a')).toEqual(['take-1', 'take-2']);
    expect(getWarmTakeIds(sections, 'c')).toEqual(['take-2', 'take-3']);
    expect(getWarmTakeIds(sections, 'd')).toEqual(['take-3']);
  });

  test('falls back to the first valid section when the active id is stale', () => {
    expect(
      getWarmTakeIds(
        [
          { id: 'a', takeId: null },
          { id: 'b', takeId: 'take-2' }
        ],
        'missing'
      )
    ).toEqual(['take-2']);
  });
});
