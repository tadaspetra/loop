/**
 * Per-frame playback advance decision for the editor draw loop.
 *
 * Lookup is strictly id-based: playback code may hold a reference to a
 * section object that has since been replaced on the timeline (undo/redo
 * restores copies, Transcribe & Cut swaps in a fresh section list). Geometry
 * is always read from the CURRENT sections array, and an active id that no
 * longer exists reports `stale` so the caller re-resolves from timeline time
 * — never guesses an index.
 */

export interface PlaybackSection {
  id: string;
  takeId?: string | null;
  start: number;
  sourceStart: number;
  sourceEnd: number;
}

export type PlaybackAdvance =
  | { status: 'stale' }
  | { status: 'continue'; timelineTime: number; activeIndex: number }
  | { status: 'end'; timelineTime: number; activeIndex: number }
  | {
      status: 'boundary';
      timelineTime: number;
      activeIndex: number;
      nextSectionId: string;
      targetSourceTime: number;
      sameTake: boolean;
    };

export function resolvePlaybackAdvance({
  sections,
  activeSectionId,
  sourceTime,
  boundaryEpsilonSec = 0.01,
  contiguityEpsilonSec = 0.05
}: {
  sections: PlaybackSection[] | null | undefined;
  activeSectionId: string | null | undefined;
  sourceTime: number;
  boundaryEpsilonSec?: number;
  contiguityEpsilonSec?: number;
}): PlaybackAdvance {
  const timeline = Array.isArray(sections) ? sections : [];
  if (!activeSectionId || !Number.isFinite(sourceTime)) return { status: 'stale' };

  const activeIndex = timeline.findIndex((section) => section.id === activeSectionId);
  if (activeIndex < 0) return { status: 'stale' };

  const active = timeline[activeIndex];
  const timelineTime = active.start + (sourceTime - active.sourceStart);

  if (sourceTime < active.sourceEnd - boundaryEpsilonSec) {
    return { status: 'continue', timelineTime, activeIndex };
  }

  const next = timeline[activeIndex + 1];
  if (!next) {
    return { status: 'end', timelineTime, activeIndex };
  }

  const sameTake = next.takeId === active.takeId;
  const contiguousSource =
    sameTake && Math.abs(sourceTime - next.sourceStart) <= contiguityEpsilonSec;
  return {
    status: 'boundary',
    timelineTime,
    activeIndex,
    nextSectionId: next.id,
    targetSourceTime: contiguousSource ? sourceTime : next.sourceStart,
    sameTake
  };
}
