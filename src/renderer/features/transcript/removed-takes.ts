/**
 * Pure helpers for separate bad-take removal: detect which stored utterances
 * are no longer covered by the timeline (the removed bad takes), subtract
 * removed ranges from kept sections, and rebuild bounds when the user
 * restores a removed take. The removed list is always derived from the
 * current sections + stored transcript, never persisted separately, so
 * undo/redo can never desync it. Nothing here touches media.
 */

import type { Section } from '../../../shared/domain/project';
import { roundMs, TRIM_PADDING } from '../timeline/section-utils';
import { BATCH_SEGMENT_MAX_GAP_SEC } from './batch-transcript';
import { normalizeTranscriptText } from './transcript-utils';

export interface SpeechSegmentLike {
  start: number;
  end: number;
  text?: string;
}

export interface SourceRange {
  start: number;
  end: number;
}

export interface RemovedTakeSegment {
  start: number;
  end: number;
  text: string;
}

/** Overlap below this is a boundary touch, not shared content. */
const OVERLAP_EPSILON_SEC = 0.05;

/**
 * An utterance still counts as removed when kept sections cover no more than
 * this fraction of it — boundary padding overlap must not hide a removed take.
 */
const REMOVED_MAX_COVERED_FRACTION = 0.15;

/** Remainder pieces shorter than this after a removal are dropped as slivers. */
export const MIN_KEPT_PIECE_SEC = 0.2;

type SectionRangeLike = Pick<Section, 'sourceStart' | 'sourceEnd'> & Partial<Section>;
type SectionLike = Pick<Section, 'takeId' | 'sourceStart' | 'sourceEnd'> & Partial<Section>;

export type TranscriptViewEntry<T extends SectionLike = Section> =
  | { kind: 'section'; section: T }
  | { kind: 'removed'; takeId: string; removed: RemovedTakeSegment };

/**
 * Joins the text of speech segments that materially overlap [start, end],
 * in segment order.
 */
export function transcriptTextForRange(
  segments: SpeechSegmentLike[] | null | undefined,
  start: number,
  end: number
): string {
  if (!Array.isArray(segments) || !Number.isFinite(start) || !Number.isFinite(end)) return '';
  const texts: string[] = [];
  for (const segment of segments) {
    const segmentStart = Number(segment?.start);
    const segmentEnd = Number(segment?.end);
    if (!Number.isFinite(segmentStart) || !Number.isFinite(segmentEnd)) continue;
    const overlap = Math.min(end, segmentEnd) - Math.max(start, segmentStart);
    if (overlap <= OVERLAP_EPSILON_SEC) continue;
    const text = normalizeTranscriptText(segment.text);
    if (text) texts.push(text);
  }
  return texts.join(' ');
}

function coveredSeconds(sections: SectionRangeLike[], start: number, end: number): number {
  let covered = 0;
  for (const section of sections) {
    const overlap =
      Math.min(end, Number(section.sourceEnd)) - Math.max(start, Number(section.sourceStart));
    if (Number.isFinite(overlap) && overlap > 0) covered += overlap;
  }
  return covered;
}

/**
 * Derives the removed bad takes for one take: spoken utterances the current
 * timeline sections no longer cover, merged into groups across small gaps.
 * A kept utterance always breaks a group so one Restore never spans content
 * that is still on the timeline.
 */
export function deriveRemovedTakeSegments({
  sections,
  utterances,
  maxGroupGapSec = BATCH_SEGMENT_MAX_GAP_SEC
}: {
  sections: SectionRangeLike[] | null | undefined;
  utterances: SpeechSegmentLike[] | null | undefined;
  maxGroupGapSec?: number;
}): RemovedTakeSegment[] {
  const keptSections = Array.isArray(sections) ? sections : [];
  const input = Array.isArray(utterances) ? utterances : [];

  const removed: RemovedTakeSegment[] = [];
  let group: RemovedTakeSegment | null = null;
  for (const utterance of input) {
    const start = Number(utterance?.start);
    const end = Number(utterance?.end);
    const text = normalizeTranscriptText(utterance?.text);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || !text) continue;

    const covered = coveredSeconds(keptSections, start, end);
    const threshold = Math.max(OVERLAP_EPSILON_SEC, REMOVED_MAX_COVERED_FRACTION * (end - start));
    if (covered > threshold) {
      group = null;
      continue;
    }

    if (group && start - group.end <= maxGroupGapSec) {
      group.end = Math.max(group.end, end);
      group.text = `${group.text} ${text}`.trim();
    } else {
      group = { start, end, text };
      removed.push(group);
    }
  }
  return removed;
}

function mergePaddedRanges(
  ranges: SourceRange[] | null | undefined,
  padSec: number
): SourceRange[] {
  if (!Array.isArray(ranges)) return [];
  const padded = ranges
    .map((range) => {
      const start = Number(range?.start);
      const end = Number(range?.end);
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
      return { start: Math.max(0, start - padSec), end: end + padSec };
    })
    .filter((range): range is SourceRange => range !== null)
    .sort((left, right) => left.start - right.start);

  const merged: SourceRange[] = [];
  for (const range of padded) {
    const last = merged[merged.length - 1];
    if (last && range.start <= last.end) {
      last.end = Math.max(last.end, range.end);
    } else {
      merged.push({ ...range });
    }
  }
  return merged;
}

interface CutPiece extends SourceRange {
  /** Whether this edge was created by a removal cut (vs. an original edge). */
  leftCut: boolean;
  rightCut: boolean;
}

/**
 * Subtracts removed source ranges (padded so surrounding silence goes with
 * them) from a take's sections. Untouched sections keep their identity;
 * split remainders get fresh ids from `makeId` (the first piece keeps the
 * original id) and their transcripts recomputed from the utterances.
 *
 * Removal-created edges are snapped inward to the nearest protected range
 * (words by default; callers add system-audio activity) plus padding, so a
 * kept piece never opens with the dead air that sat between a flub and its
 * retry. A piece with no protected content whose BOTH edges are cuts is
 * pure inter-flub silence and is dropped; original edges and one-sided
 * wordless pieces are left alone so mic-silent screen audio survives.
 */
export function removeSourceRangesFromSections<T extends SectionRangeLike>({
  sections,
  ranges,
  utterances,
  makeId,
  padSec = TRIM_PADDING,
  minKeepSec = MIN_KEPT_PIECE_SEC,
  protectedRanges,
  snapToProtected = true
}: {
  sections: T[] | null | undefined;
  ranges: SourceRange[] | null | undefined;
  utterances: SpeechSegmentLike[] | null | undefined;
  makeId: () => string;
  padSec?: number;
  minKeepSec?: number;
  protectedRanges?: SpeechSegmentLike[] | null;
  /**
   * Disable when the protected set is known to be incomplete (a take with
   * system audio but no in-session activity ranges): edges then keep the
   * plain padded removal bounds and no wordless piece is dropped, so screen
   * sound the words cannot account for is never trimmed.
   */
  snapToProtected?: boolean;
}): { sections: T[]; changed: boolean } {
  const input = Array.isArray(sections) ? sections : [];
  const removedRanges = mergePaddedRanges(ranges, padSec);
  if (removedRanges.length === 0) return { sections: [...input], changed: false };

  const protectedList = (
    Array.isArray(protectedRanges) ? protectedRanges : Array.isArray(utterances) ? utterances : []
  )
    .map((range) => ({ start: Number(range?.start), end: Number(range?.end) }))
    .filter(
      (range) => Number.isFinite(range.start) && Number.isFinite(range.end) && range.end > range.start
    )
    .sort((left, right) => left.start - right.start);

  const result: T[] = [];
  let changed = false;
  for (const section of input) {
    const sourceStart = Number(section.sourceStart);
    const sourceEnd = Number(section.sourceEnd);
    const rawPieces: CutPiece[] = [];
    let cursor = sourceStart;
    let leftCut = false;
    for (const range of removedRanges) {
      if (range.end <= cursor || range.start >= sourceEnd) continue;
      if (range.start > cursor) {
        rawPieces.push({
          start: cursor,
          end: Math.min(range.start, sourceEnd),
          leftCut,
          rightCut: true
        });
      }
      cursor = Math.max(cursor, range.end);
      leftCut = true;
    }
    if (cursor < sourceEnd) {
      rawPieces.push({ start: cursor, end: sourceEnd, leftCut, rightCut: false });
    }

    const kept: SourceRange[] = [];
    for (const piece of rawPieces) {
      let { start, end } = piece;
      if (snapToProtected) {
        const overlapping = protectedList.filter(
          (range) => Math.min(end, range.end) - Math.max(start, range.start) > 0.0001
        );
        if (overlapping.length === 0) {
          // Pure silence between two removal cuts — inter-flub pause, drop it.
          if (piece.leftCut && piece.rightCut) continue;
        } else {
          if (piece.leftCut) start = Math.max(start, overlapping[0].start - padSec);
          if (piece.rightCut) {
            end = Math.min(end, overlapping[overlapping.length - 1].end + padSec);
          }
        }
      }
      if (end - start >= minKeepSec) kept.push({ start, end });
    }

    const untouched =
      kept.length === 1 &&
      Math.abs(kept[0].start - sourceStart) < 0.0001 &&
      Math.abs(kept[0].end - sourceEnd) < 0.0001;
    if (untouched) {
      result.push(section);
      continue;
    }

    changed = true;
    kept.forEach((piece, pieceIndex) => {
      const pieceStart = roundMs(piece.start);
      const pieceEnd = roundMs(piece.end);
      result.push({
        ...section,
        id: pieceIndex === 0 ? section.id : makeId(),
        sourceStart: pieceStart,
        sourceEnd: pieceEnd,
        duration: roundMs(pieceEnd - pieceStart),
        transcript: transcriptTextForRange(utterances, pieceStart, pieceEnd)
      });
    });
  }

  return { sections: result, changed };
}

/** Silent sections at or under this length are droppable timeline noise. */
export const MAX_SILENT_SLIVER_SEC = 1.5;

/**
 * Drops short sections that contain no protected content at all (no words,
 * no system audio) — the silent slivers that earlier removals left between
 * flubs. Longer silent sections are kept: a long pause may be deliberate.
 * Untouched sections keep their identity. Callers must only invoke this
 * with a COMPLETE protection set (words plus system-audio activity).
 */
export function dropSilentSliverSections<T extends SectionRangeLike>({
  sections,
  protectedRanges,
  maxSliverSec = MAX_SILENT_SLIVER_SEC
}: {
  sections: T[] | null | undefined;
  protectedRanges: SpeechSegmentLike[] | null | undefined;
  maxSliverSec?: number;
}): { sections: T[]; droppedCount: number } {
  const input = Array.isArray(sections) ? sections : [];
  const protectedList = (Array.isArray(protectedRanges) ? protectedRanges : [])
    .map((range) => ({ start: Number(range?.start), end: Number(range?.end) }))
    .filter(
      (range) =>
        Number.isFinite(range.start) && Number.isFinite(range.end) && range.end > range.start
    );

  const kept = input.filter((section) => {
    const start = Number(section.sourceStart);
    const end = Number(section.sourceEnd);
    if (end - start > maxSliverSec) return true;
    return protectedList.some(
      (range) => Math.min(end, range.end) - Math.max(start, range.start) > 0.0001
    );
  });

  return { sections: kept, droppedCount: input.length - kept.length };
}

/**
 * Bounds for re-inserting a removed take: the padded range clamped to the
 * gap between neighboring kept sections and the take bounds. Returns null
 * when the range is already back on the timeline (its midpoint is covered)
 * or no meaningful gap remains.
 */
export function buildRestoredSectionBounds({
  range,
  sections,
  takeDuration,
  padSec = TRIM_PADDING
}: {
  range: SourceRange;
  sections: SectionRangeLike[] | null | undefined;
  takeDuration: number;
  padSec?: number;
}): { sourceStart: number; sourceEnd: number } | null {
  const rangeStart = Number(range?.start);
  const rangeEnd = Number(range?.end);
  const duration = Math.max(0, Number(takeDuration) || 0);
  if (!Number.isFinite(rangeStart) || !Number.isFinite(rangeEnd) || rangeEnd <= rangeStart) {
    return null;
  }

  const mid = (rangeStart + rangeEnd) / 2;
  let gapStart = 0;
  let gapEnd = duration > 0 ? duration : rangeEnd + padSec;
  for (const section of Array.isArray(sections) ? sections : []) {
    const sourceStart = Number(section.sourceStart);
    const sourceEnd = Number(section.sourceEnd);
    if (!Number.isFinite(sourceStart) || !Number.isFinite(sourceEnd)) continue;
    if (sourceStart < mid && mid < sourceEnd) return null;
    if (sourceEnd <= mid) gapStart = Math.max(gapStart, sourceEnd);
    if (sourceStart >= mid) gapEnd = Math.min(gapEnd, sourceStart);
  }

  const sourceStart = roundMs(Math.max(rangeStart - padSec, gapStart));
  const sourceEnd = roundMs(Math.min(rangeEnd + padSec, gapEnd));
  if (sourceEnd - sourceStart <= OVERLAP_EPSILON_SEC) return null;
  return { sourceStart, sourceEnd };
}

/**
 * Rebuilds take-local timeline positions for a take's sections (sorted by
 * source position, laid end to end from zero), matching the shape the
 * recording flow stamps into the persisted take snapshot.
 */
export function remapTakeLocalPositions<T extends SectionRangeLike>(
  sections: T[] | null | undefined
): T[] {
  const input = Array.isArray(sections) ? [...sections] : [];
  input.sort((left, right) => Number(left.sourceStart) - Number(right.sourceStart));

  let cursor = 0;
  return input.map((section, index) => {
    const duration = roundMs(
      Math.max(0, Number(section.sourceEnd) - Number(section.sourceStart))
    );
    const start = roundMs(cursor);
    const end = roundMs(cursor + duration);
    cursor += duration;
    return {
      ...section,
      index,
      label: `Section ${index + 1}`,
      start,
      end,
      duration
    };
  });
}

/**
 * Interleaves kept timeline sections with their take's removed bad takes,
 * ordered by take-local source position: removed segments land before the
 * first kept section whose source range starts after them, and after the
 * take's last section otherwise.
 */
export function buildTranscriptViewEntries<T extends SectionLike>({
  sections,
  removedByTake
}: {
  sections: T[] | null | undefined;
  removedByTake: Map<string, RemovedTakeSegment[]> | null | undefined;
}): TranscriptViewEntry<T>[] {
  const timelineSections = Array.isArray(sections) ? sections : [];
  const remainingByTake = new Map<string, RemovedTakeSegment[]>();
  if (removedByTake) {
    for (const [takeId, removed] of removedByTake) {
      if (Array.isArray(removed) && removed.length > 0) {
        remainingByTake.set(takeId, [...removed].sort((a, b) => a.start - b.start));
      }
    }
  }

  const lastSectionIndexByTake = new Map<string, number>();
  timelineSections.forEach((section, index) => {
    if (section.takeId) lastSectionIndexByTake.set(section.takeId, index);
  });

  const entries: TranscriptViewEntry<T>[] = [];
  const prevSourceEndByTake = new Map<string, number>();
  timelineSections.forEach((section, index) => {
    const takeId = section.takeId;
    const remaining = takeId ? remainingByTake.get(takeId) : undefined;
    if (takeId && remaining) {
      const prevEnd = prevSourceEndByTake.get(takeId) ?? 0;
      while (
        remaining.length > 0 &&
        remaining[0].end <= section.sourceStart + OVERLAP_EPSILON_SEC
      ) {
        const removed = remaining.shift() as RemovedTakeSegment;
        // Drop entries the kept ranges have since grown over.
        if (removed.start < prevEnd - OVERLAP_EPSILON_SEC) continue;
        entries.push({ kind: 'removed', takeId, removed });
      }
    }
    entries.push({ kind: 'section', section });
    if (takeId) {
      prevSourceEndByTake.set(takeId, section.sourceEnd);
      if (remaining && lastSectionIndexByTake.get(takeId) === index) {
        for (const removed of remaining) {
          if (removed.start >= section.sourceEnd - OVERLAP_EPSILON_SEC) {
            entries.push({ kind: 'removed', takeId, removed });
          }
        }
        remainingByTake.delete(takeId);
      }
    }
  });

  return entries;
}
