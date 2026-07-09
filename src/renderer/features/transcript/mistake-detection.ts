/**
 * Repeated-take ("mistake") detection for Transcribe & Cut.
 *
 * When a speaker flubs a line they usually pause and re-record it, so a
 * mistake shows up in the transcript as an utterance that the next utterance
 * repeats — either verbatim or as an aborted prefix of the full retry. This
 * module works on fine-grained utterances (words grouped at a smaller silence
 * gap than the normal segment threshold, because retry pauses are typically
 * shorter than 1.5s), drops the earlier take(s) so the LAST take survives,
 * and re-merges the survivors at the normal gap so silence-cut boundaries are
 * unchanged wherever nothing was removed.
 *
 * Detection is purely textual and deterministic: normalized token similarity
 * with a prefix-aware comparison. Media files are never touched — removal only
 * excludes source ranges from the sections built afterwards.
 */

import { BATCH_SEGMENT_MAX_GAP_SEC, type SpeechSegment } from './batch-transcript';

/** Silence gap (seconds) used to split words into fine-grained utterances. */
export const MISTAKE_UTTERANCE_GAP_SEC = 0.5;

/** Utterances with fewer meaningful tokens than this are never removed. */
export const MISTAKE_MIN_TOKENS = 3;

/** Normalized token similarity at or above this marks the earlier take a mistake. */
export const MISTAKE_SIMILARITY_THRESHOLD = 0.8;

/** A retry must start within this many seconds of the flub's end. */
export const MISTAKE_MAX_RETRY_GAP_SEC = 8;

/**
 * A single utterance between flub and retry (an "ugh, nope") is removed with
 * the flub only when it has at most this many tokens; anything longer blocks
 * the lookahead so real content is never skipped over.
 */
export const MISTAKE_MAX_INTERJECTION_TOKENS = 4;

/** Hesitation sounds ignored when comparing takes. */
const FILLER_TOKENS = new Set(['um', 'uh', 'uhm', 'umm', 'erm', 'hmm', 'hm', 'mm', 'mhm', 'er']);

export interface RemovedTake {
  /** Recording-time span of the removed flub (including a removed interjection). */
  start: number;
  end: number;
  /** Transcript of the removed take. */
  text: string;
  /** Transcript of the retry that replaced it. */
  retryText: string;
}

export interface MistakeDetection {
  /** Indices into the input utterance array that should be dropped. */
  removedIndices: Set<number>;
  /** One entry per detected flubbed take. */
  removed: RemovedTake[];
}

export interface MistakeDetectionOptions {
  minTokens?: number;
  similarityThreshold?: number;
  maxRetryGapSec?: number;
  maxInterjectionTokens?: number;
}

/**
 * Tokenizes utterance text for comparison: lowercased, punctuation stripped
 * (apostrophes kept for contractions), hesitation fillers dropped.
 */
export function normalizeComparisonTokens(text: string): string[] {
  return String(text || '')
    .toLowerCase()
    .split(/\s+/)
    .map((token) => token.replace(/[^\p{L}\p{N}']/gu, ''))
    .filter((token) => token.length > 0 && !FILLER_TOKENS.has(token));
}

function tokenEditDistance(a: string[], b: string[]): number {
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
    previous = current;
  }
  return previous[b.length];
}

/**
 * Similarity of two token lists in [0, 1]: 1 - editDistance / maxLength.
 */
export function tokenSimilarity(a: string[], b: string[]): number {
  const maxLength = Math.max(a.length, b.length);
  if (maxLength === 0) return 1;
  return 1 - tokenEditDistance(a, b) / maxLength;
}

/**
 * Finds flubbed takes among fine-grained utterances. An utterance is a flub
 * when a following utterance (directly next, or one short interjection later)
 * starts with substantially the same tokens — so the last take always wins.
 */
export function detectRepeatedTakes(
  utterances: SpeechSegment[],
  {
    minTokens = MISTAKE_MIN_TOKENS,
    similarityThreshold = MISTAKE_SIMILARITY_THRESHOLD,
    maxRetryGapSec = MISTAKE_MAX_RETRY_GAP_SEC,
    maxInterjectionTokens = MISTAKE_MAX_INTERJECTION_TOKENS
  }: MistakeDetectionOptions = {}
): MistakeDetection {
  const input = Array.isArray(utterances) ? utterances : [];
  const tokens = input.map((utterance) => normalizeComparisonTokens(utterance?.text || ''));
  const removedIndices = new Set<number>();
  const removed: RemovedTake[] = [];

  for (let i = 0; i < input.length - 1; i += 1) {
    // Already dropped as an interjection attached to an earlier flub.
    if (removedIndices.has(i)) continue;
    const candidate = tokens[i];
    if (candidate.length < minTokens) continue;

    for (const j of [i + 1, i + 2]) {
      if (j >= input.length) break;
      // Only look past the direct neighbor when it is a short interjection.
      if (j === i + 2 && tokens[i + 1].length > maxInterjectionTokens) break;
      if (input[j].start - input[i].end > maxRetryGapSec) break;

      const retry = tokens[j];
      // Prefix-aware comparison: an aborted attempt matches the start of the
      // full retry; a verbatim repeat matches all of it. When the retry is
      // shorter than the candidate the length penalty applies naturally.
      const target = retry.slice(0, Math.min(retry.length, candidate.length));
      if (tokenSimilarity(candidate, target) >= similarityThreshold) {
        removedIndices.add(i);
        const lastRemoved = j - 1;
        if (lastRemoved > i) removedIndices.add(lastRemoved);
        removed.push({
          start: input[i].start,
          end: input[lastRemoved].end,
          text: input[i].text,
          retryText: input[j].text
        });
        break;
      }
    }
  }

  return { removedIndices, removed };
}

/**
 * Re-merges kept utterances into speech segments at the normal silence gap.
 * Utterances are never merged across a removed take, so the flub's source
 * range always falls in a gap and gets cut with the silence around it.
 */
export function mergeSpeechSegments(
  utterances: SpeechSegment[],
  {
    removedIndices,
    maxGapSec = BATCH_SEGMENT_MAX_GAP_SEC
  }: { removedIndices: Set<number>; maxGapSec?: number }
): SpeechSegment[] {
  const input = Array.isArray(utterances) ? utterances : [];
  const merged: SpeechSegment[] = [];
  let removedSinceLastKept = false;

  for (let index = 0; index < input.length; index += 1) {
    if (removedIndices.has(index)) {
      removedSinceLastKept = true;
      continue;
    }
    const utterance = input[index];
    const last = merged[merged.length - 1];
    if (last && !removedSinceLastKept && utterance.start - last.end <= maxGapSec) {
      last.end = Math.max(last.end, utterance.end);
      last.text = `${last.text} ${utterance.text}`.trim();
    } else {
      merged.push({ ...utterance });
    }
    removedSinceLastKept = false;
  }

  return merged;
}

/**
 * Convenience pipeline: detect flubbed takes among fine-grained utterances,
 * drop them, and return normal-gap speech segments plus what was removed.
 */
export function cutRepeatedTakes(
  utterances: SpeechSegment[],
  options: MistakeDetectionOptions & { mergeGapSec?: number } = {}
): { segments: SpeechSegment[]; removed: RemovedTake[] } {
  const { removedIndices, removed } = detectRepeatedTakes(utterances, options);
  const segments = mergeSpeechSegments(utterances, {
    removedIndices,
    maxGapSec: options.mergeGapSec ?? BATCH_SEGMENT_MAX_GAP_SEC
  });
  return { segments, removed };
}
