/**
 * Bad-take detection for the manual "Remove Bad Takes" action.
 *
 * The conservative repeated-take detector (mistake-detection.ts) requires an
 * exact token-prefix match and a tight retry gap, which misses how people
 * actually restart: they rephrase ("use your s--" → "use ElevenLabs…"),
 * stutter ("from, from--"), and pause longer than 1.5s to collect themselves.
 *
 * This module adds a restart-cluster detector keyed on the transcription
 * service's cutoff markers ("--", "…", "..."): a stretch of speech that ends
 * cut off is a bad take when a nearby completed retry shares its opening
 * words and covers most of its content. Because removal is an explicit user
 * action with a visible Restore path (unlike the old automatic flow), this
 * detector is deliberately more assertive than the conservative one — both
 * run, and the union of their findings is returned.
 *
 * Pure data transforms over {start, end, text} segments; no I/O.
 */

import { cutRepeatedTakes, mergeSpeechSegments, normalizeComparisonTokens } from './mistake-detection';
import { normalizeTranscriptText } from './transcript-utils';

export interface SpeechSegmentLike {
  start: number;
  end: number;
  text?: string;
}

export interface BadTakeRange {
  start: number;
  end: number;
  text: string;
}

export interface AttemptUnit {
  start: number;
  end: number;
  text: string;
  /** The source segments (words, or coarser legacy utterances) composing
   * this unit, in order — used to time-slice a partial removal. */
  segments: BadTakeRange[];
}

/** Gap that separates attempt units (matches the fine utterance gap). */
export const RESTART_UNIT_GAP_SEC = 0.5;

/** Max silence between consecutive units for them to stay in one cluster. */
export const RESTART_MAX_HOP_GAP_SEC = 4;

/** The flub and its retry must share at least this many opening tokens. */
export const RESTART_MIN_SHARED_OPENING_TOKENS = 4;

/** The retry must continue at least this far beyond the shared opening. */
export const RESTART_MIN_CONTINUATION_TOKENS = 2;

/** At least this fraction of the flub's tokens must reappear in the retry. */
export const RESTART_MIN_TOKEN_OVERLAP = 0.6;

/** Trailing cutoff markers the transcription service emits for aborted speech. */
const CUTOFF_MARKER_RE = /(?:\.{2,}|…|[—–-])["')\]»”’]*$/u;

export function endsWithCutoffMarker(text: string): boolean {
  return CUTOFF_MARKER_RE.test(String(text || '').trim());
}

export function sanitizeSegments(
  segments: SpeechSegmentLike[] | null | undefined
): BadTakeRange[] {
  if (!Array.isArray(segments)) return [];
  return segments
    .map((segment) => {
      const start = Number(segment?.start);
      const end = Number(segment?.end);
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
      const text = normalizeTranscriptText(segment?.text);
      if (!text) return null;
      return { start, end, text };
    })
    .filter((segment): segment is BadTakeRange => segment !== null)
    .sort((left, right) => left.start - right.start);
}

/**
 * Groups transcript segments (words, or coarser utterances from older
 * projects) into attempt units: a new unit starts after a silence gap or
 * after a segment that ends with a cutoff marker. With word-level segments
 * this lets a restart inside one breath split at the exact word boundary.
 */
export function groupAttemptUnits(
  segments: SpeechSegmentLike[] | null | undefined,
  { unitGapSec = RESTART_UNIT_GAP_SEC }: { unitGapSec?: number } = {}
): AttemptUnit[] {
  const sanitized = sanitizeSegments(segments);
  const units: AttemptUnit[] = [];
  let previous: BadTakeRange | null = null;
  for (const segment of sanitized) {
    const startsNewUnit =
      !previous ||
      segment.start - previous.end > unitGapSec ||
      endsWithCutoffMarker(previous.text);
    if (startsNewUnit || units.length === 0) {
      units.push({
        start: segment.start,
        end: segment.end,
        text: segment.text,
        segments: [segment]
      });
    } else {
      const unit = units[units.length - 1];
      unit.end = Math.max(unit.end, segment.end);
      unit.text = `${unit.text} ${segment.text}`;
      unit.segments.push(segment);
    }
    previous = segment;
  }
  return units;
}

/** Collapses immediate word repeats ("from from" → "from") — stutters. */
function dedupImmediateRepeats(tokens: string[]): string[] {
  return tokens.filter((token, index) => token !== tokens[index - 1]);
}

function comparisonTokens(text: string): string[] {
  return dedupImmediateRepeats(normalizeComparisonTokens(text));
}

interface UnitTokenEntry {
  token: string;
  unitIndex: number;
  segmentIndex: number;
}

/**
 * One entry per comparison token across a window of units, remembering which
 * unit and segment each token came from so a match maps back to a time.
 */
function windowTokenEntries(
  units: AttemptUnit[],
  fromUnit: number,
  toUnit: number
): UnitTokenEntry[] {
  const entries: UnitTokenEntry[] = [];
  for (let unitIndex = fromUnit; unitIndex <= toUnit; unitIndex += 1) {
    units[unitIndex].segments.forEach((segment, segmentIndex) => {
      for (const token of normalizeComparisonTokens(segment.text)) {
        entries.push({ token, unitIndex, segmentIndex });
      }
    });
  }
  return entries;
}

/** Joined segment texts from a window position through the last unit. */
function windowTextFrom(
  units: AttemptUnit[],
  entry: UnitTokenEntry,
  toUnit: number
): string {
  const parts: string[] = [];
  for (let unitIndex = entry.unitIndex; unitIndex <= toUnit; unitIndex += 1) {
    const fromSegment = unitIndex === entry.unitIndex ? entry.segmentIndex : 0;
    for (const segment of units[unitIndex].segments.slice(fromSegment)) {
      parts.push(segment.text);
    }
  }
  return parts.join(' ');
}

/**
 * How many of the retry's opening tokens match the unit's tokens starting at
 * `from`, skipping the unit's immediate stutter repeats ("from, from--").
 */
function sharedOpeningAt(
  entries: UnitTokenEntry[],
  from: number,
  retryTokens: string[]
): number {
  let shared = 0;
  let position = from;
  while (position < entries.length && shared < retryTokens.length) {
    if (entries[position].token === retryTokens[shared]) {
      shared += 1;
      position += 1;
    } else if (position > from && entries[position].token === entries[position - 1].token) {
      position += 1;
    } else {
      break;
    }
  }
  return shared;
}

/**
 * Restart-cluster detection: a unit ending with a cutoff marker contains a
 * bad take when a following unit within hop range restarts the same thought —
 * shared opening, material continuation, and most of the flubbed words
 * reappearing in the retry.
 *
 * The retry's opening is matched at every position inside the unit, rightmost
 * match wins, and only the suffix from that restart point is removed. This
 * keeps the common part-good/part-bad case intact: a good final take of one
 * section flowing without a pause into a flubbed start of the next section
 * loses only the flubbed tail. A whole-unit removal is the position-0 case.
 * Candidate retries may themselves end cut off (a chained unit can fix the
 * previous section while flubbing the next); the overlap guard rejects
 * unrelated siblings.
 */
export function detectRestartUnits(
  units: AttemptUnit[],
  {
    maxHopGapSec = RESTART_MAX_HOP_GAP_SEC,
    minSharedOpeningTokens = RESTART_MIN_SHARED_OPENING_TOKENS,
    minContinuationTokens = RESTART_MIN_CONTINUATION_TOKENS,
    minTokenOverlap = RESTART_MIN_TOKEN_OVERLAP
  }: {
    maxHopGapSec?: number;
    minSharedOpeningTokens?: number;
    minContinuationTokens?: number;
    minTokenOverlap?: number;
  } = {}
): BadTakeRange[] {
  const input = Array.isArray(units) ? units : [];
  const removed: BadTakeRange[] = [];

  for (let index = 0; index < input.length; index += 1) {
    const unit = input[index];
    if (!endsWithCutoffMarker(unit.text)) continue;

    // A flubbed take can span several units when the speaker pauses
    // mid-attempt: only the last unit carries the cutoff marker, while the
    // retry restarts from the attempt's beginning. Extend the searchable
    // stream backward through immediately preceding units — stopping at an
    // earlier flub's marker (a separate attempt) or a large silence hop.
    let windowStart = index;
    while (windowStart > 0) {
      const previous = input[windowStart - 1];
      if (endsWithCutoffMarker(previous.text)) break;
      if (input[windowStart].start - previous.end > maxHopGapSec) break;
      windowStart -= 1;
    }
    const entries = windowTokenEntries(input, windowStart, index);
    if (entries.length === 0) continue;

    let match: { start: number; text: string } | null = null;
    for (let candidate = index + 1; candidate < input.length && !match; candidate += 1) {
      if (input[candidate].start - input[candidate - 1].end > maxHopGapSec) break;
      const retryTokens = comparisonTokens(input[candidate].text);
      if (retryTokens.length < minSharedOpeningTokens + minContinuationTokens) continue;

      // Rightmost matching restart point removes the least speech.
      for (let from = entries.length - 1; from >= 0 && !match; from -= 1) {
        // A restart point must sit on a segment boundary to be time-sliceable
        // (always true for word-level segments; restricts coarse legacy
        // storage to whole-unit removal).
        if (
          from > 0 &&
          entries[from].unitIndex === entries[from - 1].unitIndex &&
          entries[from].segmentIndex === entries[from - 1].segmentIndex
        ) {
          continue;
        }

        const shared = sharedOpeningAt(entries, from, retryTokens);
        if (shared < minSharedOpeningTokens) continue;
        if (retryTokens.length < shared + minContinuationTokens) continue;

        const suffixTokens = dedupImmediateRepeats(
          entries.slice(from).map((entry) => entry.token)
        );
        const retrySet = new Set(retryTokens);
        const overlap =
          suffixTokens.filter((token) => retrySet.has(token)).length / suffixTokens.length;
        if (overlap < minTokenOverlap) continue;

        const startSegment = input[entries[from].unitIndex].segments[entries[from].segmentIndex];
        match = {
          start: startSegment.start,
          text: windowTextFrom(input, entries[from], index)
        };
      }
    }

    if (match) {
      removed.push({ start: match.start, end: unit.end, text: match.text });
    }
  }

  return removed;
}

export function mergeBadTakeRanges(ranges: BadTakeRange[]): BadTakeRange[] {
  return mergeOverlappingRanges(ranges);
}

function mergeOverlappingRanges(ranges: BadTakeRange[]): BadTakeRange[] {
  const sorted = [...ranges].sort((left, right) => left.start - right.start);
  const merged: BadTakeRange[] = [];
  for (const range of sorted) {
    const last = merged[merged.length - 1];
    if (last && range.start < last.end - 0.0001) {
      last.end = Math.max(last.end, range.end);
      if (range.text.length > last.text.length) last.text = range.text;
    } else {
      merged.push({ ...range });
    }
  }
  return merged;
}

/**
 * The union of both detectors over a take's stored transcript segments:
 * restart clusters (cutoff marker + shared opening + content overlap) and
 * the conservative exact-prefix repeated-take detector. Overlapping findings
 * are merged so each bad take is reported once.
 */
export function detectBadTakes(
  segments: SpeechSegmentLike[] | null | undefined
): BadTakeRange[] {
  const sanitized = sanitizeSegments(segments);
  if (sanitized.length === 0) return [];

  const restartRemoved = detectRestartUnits(groupAttemptUnits(sanitized));

  // The conservative detector expects fine-grained utterances; rebuild them
  // from the stored segments at the same gap regardless of storage
  // granularity (words or utterances).
  const utterances = mergeSpeechSegments(sanitized, {
    removedIndices: new Set(),
    maxGapSec: RESTART_UNIT_GAP_SEC
  });
  const conservativeRemoved = cutRepeatedTakes(utterances).removed.map((take) => ({
    start: take.start,
    end: take.end,
    text: take.text
  }));

  return mergeOverlappingRanges([...restartRemoved, ...conservativeRemoved]);
}
