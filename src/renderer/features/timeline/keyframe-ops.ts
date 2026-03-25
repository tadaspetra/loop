import type { Keyframe } from '../../../shared/domain/project';

/**
 * Pure keyframe operations for split/delete that preserve stable section IDs.
 */

let sectionCounter = 0;

export interface KeyframeDefaults {
  pipX: number;
  pipY: number;
  backgroundZoom?: number;
}

/**
 * Generate a unique section ID that won't collide with sequential IDs.
 */
export function generateSectionId(): string {
  sectionCounter += 1;
  return `section-${Date.now()}-${sectionCounter}`;
}

/**
 * Reindex sections: update index and label without changing id.
 * Mutates the sections in place.
 */
export function reindexSections(
  sections: Array<{ id: string; index: number; label: string }>,
): void {
  for (let index = 0; index < sections.length; index += 1) {
    sections[index].index = index;
    sections[index].label = `Section ${index + 1}`;
  }
}

/**
 * Create an anchor keyframe for a split-off section,
 * inheriting camera state from the parent section's anchor.
 */
export function buildSplitAnchorKeyframe(
  keyframes: Keyframe[],
  parentSectionId: string | null,
  newSectionId: string,
  newSectionStart: number,
  defaults: KeyframeDefaults,
): Keyframe {
  const parent = (keyframes || []).find(
    (keyframe) => keyframe.sectionId === parentSectionId,
  );
  const defaultZoom = defaults.backgroundZoom ?? 1;
  return {
    time: newSectionStart,
    pipX: parent?.pipX ?? defaults.pipX,
    pipY: parent?.pipY ?? defaults.pipY,
    pipVisible: parent?.pipVisible ?? true,
    cameraFullscreen: parent?.cameraFullscreen ?? false,
    backgroundZoom: parent?.backgroundZoom ?? defaultZoom,
    backgroundPanX: parent?.backgroundPanX ?? 0,
    backgroundPanY: parent?.backgroundPanY ?? 0,
    sectionId: newSectionId,
    autoSection: true,
  };
}
