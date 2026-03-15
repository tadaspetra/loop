/**
 * Pure keyframe operations for split/delete that preserve stable section IDs.
 */

let _sectionCounter = 0;

/**
 * Generate a unique section ID that won't collide with sequential IDs.
 */
export function generateSectionId() {
  _sectionCounter += 1;
  return `section-${Date.now()}-${_sectionCounter}`;
}

/**
 * Reindex sections: update index and label without changing id.
 * Mutates the sections in place.
 */
export function reindexSections(sections) {
  for (let i = 0; i < sections.length; i++) {
    sections[i].index = i;
    sections[i].label = `Section ${i + 1}`;
  }
}

/**
 * Create an anchor keyframe for a split-off section,
 * inheriting camera state from the parent section's anchor.
 */
export function buildSplitAnchorKeyframe(keyframes, parentSectionId, newSectionId, newSectionStart, defaults) {
  const parent = (keyframes || []).find(kf => kf.sectionId === parentSectionId);
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
