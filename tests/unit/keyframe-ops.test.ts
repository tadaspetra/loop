import { describe, expect, test } from 'vitest';

import {
  buildSplitAnchorKeyframe,
  generateSectionId,
  moveSectionToIndex,
  moveSectionsToIndex,
  reindexSections
} from '../../src/renderer/features/timeline/keyframe-ops';
import type { Keyframe } from '../../src/shared/domain/project';

describe('keyframe-ops', () => {
  describe('generateSectionId', () => {
    test('generates unique IDs', () => {
      const id1 = generateSectionId();
      const id2 = generateSectionId();
      expect(id1).not.toBe(id2);
      expect(id1).toMatch(/^section-/);
      expect(id2).toMatch(/^section-/);
    });
  });

  describe('reindexSections', () => {
    test('updates index and label without changing id', () => {
      const sections = [
        { id: 'custom-abc', index: 5, label: 'old' },
        { id: 'custom-def', index: 9, label: 'old2' }
      ];
      reindexSections(sections);
      expect(sections[0].id).toBe('custom-abc');
      expect(sections[0].index).toBe(0);
      expect(sections[0].label).toBe('Section 1');
      expect(sections[1].id).toBe('custom-def');
      expect(sections[1].index).toBe(1);
      expect(sections[1].label).toBe('Section 2');
    });
  });

  describe('moveSectionToIndex', () => {
    function makeSections(count: number) {
      return Array.from({ length: count }, (_, i) => ({
        id: `s-${i + 1}`,
        index: i,
        label: `Section ${i + 1}`,
      }));
    }

    test('moves section forward in array', () => {
      const sections = makeSections(4);
      const result = moveSectionToIndex(sections, 0, 2);
      expect(result).toBe(true);
      expect(sections.map(s => s.id)).toEqual(['s-2', 's-3', 's-1', 's-4']);
      expect(sections[0].index).toBe(0);
      expect(sections[0].label).toBe('Section 1');
      expect(sections[2].index).toBe(2);
      expect(sections[2].label).toBe('Section 3');
    });

    test('moves section backward in array', () => {
      const sections = makeSections(4);
      const result = moveSectionToIndex(sections, 3, 1);
      expect(result).toBe(true);
      expect(sections.map(s => s.id)).toEqual(['s-1', 's-4', 's-2', 's-3']);
    });

    test('returns false for same position', () => {
      const sections = makeSections(3);
      expect(moveSectionToIndex(sections, 1, 1)).toBe(false);
      expect(sections.map(s => s.id)).toEqual(['s-1', 's-2', 's-3']);
    });

    test('returns false for out of bounds indices', () => {
      const sections = makeSections(3);
      expect(moveSectionToIndex(sections, -1, 1)).toBe(false);
      expect(moveSectionToIndex(sections, 1, 5)).toBe(false);
      expect(moveSectionToIndex(sections, 3, 0)).toBe(false);
    });

    test('handles move to first position', () => {
      const sections = makeSections(3);
      moveSectionToIndex(sections, 2, 0);
      expect(sections.map(s => s.id)).toEqual(['s-3', 's-1', 's-2']);
      expect(sections[0].label).toBe('Section 1');
    });

    test('handles move to last position', () => {
      const sections = makeSections(3);
      moveSectionToIndex(sections, 0, 2);
      expect(sections.map(s => s.id)).toEqual(['s-2', 's-3', 's-1']);
      expect(sections[2].label).toBe('Section 3');
    });

    test('preserves section IDs', () => {
      const sections = makeSections(4);
      const originalIds = sections.map(s => s.id);
      moveSectionToIndex(sections, 1, 3);
      const newIds = sections.map(s => s.id);
      expect(newIds.sort()).toEqual(originalIds.sort());
    });

    test('works with two sections', () => {
      const sections = makeSections(2);
      moveSectionToIndex(sections, 0, 1);
      expect(sections.map(s => s.id)).toEqual(['s-2', 's-1']);
    });
  });

  describe('moveSectionsToIndex', () => {
    function makeSections(count: number) {
      return Array.from({ length: count }, (_, i) => ({
        id: `s-${i + 1}`,
        index: i,
        label: `Section ${i + 1}`,
      }));
    }

    test('moves a group of sections to the beginning', () => {
      const sections = makeSections(5);
      const result = moveSectionsToIndex(sections, new Set(['s-3', 's-4']), 0);
      expect(result).toBe(true);
      expect(sections.map(s => s.id)).toEqual(['s-3', 's-4', 's-1', 's-2', 's-5']);
    });

    test('moves a group of sections to the end', () => {
      const sections = makeSections(5);
      const result = moveSectionsToIndex(sections, new Set(['s-2', 's-3']), 3);
      expect(result).toBe(true);
      expect(sections.map(s => s.id)).toEqual(['s-1', 's-4', 's-5', 's-2', 's-3']);
    });

    test('moves non-contiguous sections preserving their relative order', () => {
      const sections = makeSections(5);
      const result = moveSectionsToIndex(sections, new Set(['s-1', 's-4']), 2);
      expect(result).toBe(true);
      expect(sections.map(s => s.id)).toEqual(['s-2', 's-3', 's-1', 's-4', 's-5']);
    });

    test('returns false when order does not change', () => {
      const sections = makeSections(4);
      // s-2, s-3 are already at insert position 1 among remaining [s-1, s-4]
      const result = moveSectionsToIndex(sections, new Set(['s-2', 's-3']), 1);
      expect(result).toBe(false);
      expect(sections.map(s => s.id)).toEqual(['s-1', 's-2', 's-3', 's-4']);
    });

    test('returns false for empty selectedIds', () => {
      const sections = makeSections(3);
      expect(moveSectionsToIndex(sections, new Set(), 0)).toBe(false);
    });

    test('returns false when all sections are selected', () => {
      const sections = makeSections(3);
      expect(moveSectionsToIndex(sections, new Set(['s-1', 's-2', 's-3']), 0)).toBe(false);
    });

    test('clamps insertBefore to valid range', () => {
      const sections = makeSections(4);
      moveSectionsToIndex(sections, new Set(['s-1']), 99);
      expect(sections.map(s => s.id)).toEqual(['s-2', 's-3', 's-4', 's-1']);
    });

    test('reindexes sections after move', () => {
      const sections = makeSections(4);
      moveSectionsToIndex(sections, new Set(['s-4']), 0);
      expect(sections[0].index).toBe(0);
      expect(sections[0].label).toBe('Section 1');
      expect(sections[3].index).toBe(3);
      expect(sections[3].label).toBe('Section 4');
    });
  });

  describe('buildSplitAnchorKeyframe', () => {
    const defaults = { pipX: 100, pipY: 200 };

    test('inherits camera state from parent section anchor', () => {
      const keyframes = [
        {
          time: 0,
          pipX: 50,
          pipY: 60,
          pipVisible: false,
          cameraFullscreen: true,
          backgroundZoom: 1.5,
          backgroundPanX: 0.3,
          backgroundPanY: -0.2,
          sectionId: 'parent-1',
          autoSection: true
        }
      ];
      const result = buildSplitAnchorKeyframe(keyframes, 'parent-1', 'new-section', 5.0, defaults);
      expect(result.pipX).toBe(50);
      expect(result.pipY).toBe(60);
      expect(result.pipVisible).toBe(false);
      expect(result.cameraFullscreen).toBe(true);
      expect(result.backgroundZoom).toBe(1.5);
      expect(result.backgroundPanX).toBe(0.3);
      expect(result.backgroundPanY).toBe(-0.2);
      expect(result.sectionId).toBe('new-section');
      expect(result.time).toBe(5.0);
      expect(result.autoSection).toBe(true);
    });

    test('uses defaults when parent anchor not found', () => {
      const result = buildSplitAnchorKeyframe([], 'missing', 'new-section', 3.0, defaults);
      expect(result.pipX).toBe(100);
      expect(result.pipY).toBe(200);
      expect(result.pipVisible).toBe(true);
      expect(result.cameraFullscreen).toBe(false);
      expect(result.backgroundZoom).toBe(1);
      expect(result.backgroundPanX).toBe(0);
      expect(result.backgroundPanY).toBe(0);
    });

    test('preserves pipVisible=false from parent', () => {
      const keyframes = [
        { time: 0, pipX: 10, pipY: 20, pipVisible: false, sectionId: 's-1' }
      ] as Keyframe[];
      const result = buildSplitAnchorKeyframe(keyframes, 's-1', 'new', 1.0, defaults);
      expect(result.pipVisible).toBe(false);
    });
  });

  describe('split preserves existing keyframe states', () => {
    test('splitting adds one keyframe without modifying existing ones', () => {
      // 3 sections with custom camera states
      const keyframes = [
        { time: 0, pipX: 10, pipY: 20, pipVisible: true, cameraFullscreen: false, sectionId: 's-1', autoSection: true },
        { time: 5, pipX: 30, pipY: 40, pipVisible: false, cameraFullscreen: false, sectionId: 's-2', autoSection: true },
        { time: 10, pipX: 50, pipY: 60, pipVisible: true, cameraFullscreen: true, sectionId: 's-3', autoSection: true }
      ] as Keyframe[];
      const splitDefaults = { pipX: 100, pipY: 200 };

      // Split s-2 at timeline time 7.5
      const newId = generateSectionId();
      const newAnchor = buildSplitAnchorKeyframe(keyframes, 's-2', newId, 7.5, splitDefaults);
      const updated = [...keyframes, newAnchor].sort((a, b) => a.time - b.time);

      // Existing keyframes are untouched
      const s1kf = updated.find((kf) => kf.sectionId === 's-1');
      expect(s1kf!.pipX).toBe(10);
      expect(s1kf!.pipY).toBe(20);
      expect(s1kf!.pipVisible).toBe(true);

      const s2kf = updated.find((kf) => kf.sectionId === 's-2');
      expect(s2kf!.pipX).toBe(30);
      expect(s2kf!.pipY).toBe(40);
      expect(s2kf!.pipVisible).toBe(false);

      const s3kf = updated.find((kf) => kf.sectionId === 's-3');
      expect(s3kf!.pipX).toBe(50);
      expect(s3kf!.pipY).toBe(60);
      expect(s3kf!.cameraFullscreen).toBe(true);

      // New section inherits from parent (s-2)
      const newKf = updated.find((kf) => kf.sectionId === newId);
      expect(newKf!.pipX).toBe(30);
      expect(newKf!.pipY).toBe(40);
      expect(newKf!.pipVisible).toBe(false);
      expect(newKf!.time).toBe(7.5);
    });
  });

  describe('delete preserves remaining section keyframes', () => {
    test('removing a section anchor does not affect other anchors', () => {
      const keyframes = [
        { time: 0, pipX: 10, pipY: 20, pipVisible: true, cameraFullscreen: false, sectionId: 's-1', autoSection: true },
        { time: 5, pipX: 30, pipY: 40, pipVisible: false, cameraFullscreen: false, sectionId: 's-2', autoSection: true },
        { time: 10, pipX: 50, pipY: 60, pipVisible: true, cameraFullscreen: true, sectionId: 's-3', autoSection: true }
      ];

      // Delete s-2: filter out its anchor, keep others
      const remaining = keyframes.filter((kf) => kf.sectionId !== 's-2');

      expect(remaining).toHaveLength(2);
      expect(remaining.find((kf) => kf.sectionId === 's-1')!.pipX).toBe(10);
      expect(remaining.find((kf) => kf.sectionId === 's-3')!.pipX).toBe(50);
      expect(remaining.find((kf) => kf.sectionId === 's-3')!.cameraFullscreen).toBe(true);
    });
  });
});
