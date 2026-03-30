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
  sections: Array<{ id: string; index: number; label: string }>
): void {
  for (let index = 0; index < sections.length; index += 1) {
    sections[index].index = index;
    sections[index].label = `Section ${index + 1}`;
  }
}

/**
 * Move a section from one array position to another.
 * Mutates the array in place and reindexes.
 * Returns true if the move was performed.
 */
export function moveSectionToIndex(
  sections: Array<{ id: string; index: number; label: string }>,
  fromIndex: number,
  toIndex: number
): boolean {
  if (fromIndex < 0 || fromIndex >= sections.length) return false;
  if (toIndex < 0 || toIndex >= sections.length) return false;
  if (fromIndex === toIndex) return false;

  const [moved] = sections.splice(fromIndex, 1);
  sections.splice(toIndex, 0, moved);
  reindexSections(sections);
  return true;
}

/**
 * Move a group of sections to a new position among the remaining sections.
 * `insertBefore` is the index in the non-selected sections where the group
 * should be inserted (0 = before all remaining, remaining.length = after all).
 * Mutates the array in place and reindexes.
 * Returns true if the order changed.
 */
export function moveSectionsToIndex(
  sections: Array<{ id: string; index: number; label: string }>,
  selectedIds: Set<string>,
  insertBefore: number
): boolean {
  if (selectedIds.size === 0) return false;

  const selected: typeof sections = [];
  const remaining: typeof sections = [];
  for (const s of sections) {
    if (selectedIds.has(s.id)) selected.push(s);
    else remaining.push(s);
  }

  if (selected.length === 0 || remaining.length === 0) return false;

  const clamped = Math.max(0, Math.min(insertBefore, remaining.length));
  const result = [...remaining.slice(0, clamped), ...selected, ...remaining.slice(clamped)];

  if (result.every((s, i) => s.id === sections[i].id)) return false;

  sections.length = 0;
  sections.push(...result);
  reindexSections(sections);
  return true;
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
  defaults: KeyframeDefaults
): Keyframe {
  const parent = (keyframes || []).find((keyframe) => keyframe.sectionId === parentSectionId);
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
    autoSection: true
  };
}
