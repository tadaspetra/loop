/**
 * Repeated-take ("mistake") detection for Transcribe & Cut.
 *
 * When a speaker flubs a line they usually pause and re-record it, so a
 * mistake shows up in the transcript as an utterance that the next utterance
 * repeats as an aborted prefix of the full retry. This module works on
 * fine-grained utterances (words grouped at a smaller silence gap than the
 * normal segment threshold), drops only high-confidence abandoned prefixes,
 * and re-merges the survivors at the normal gap so silence-cut boundaries are
 * unchanged wherever nothing was removed.
 *
 * Detection is deterministic and deliberately conservative. Media files are
 * never touched — removal only excludes source ranges from sections built
 * afterwards.
 */

import { BATCH_SEGMENT_MAX_GAP_SEC, type SpeechSegment } from './batch-transcript';

/** Silence gap (seconds) used to split words into fine-grained utterances. */
export const MISTAKE_UTTERANCE_GAP_SEC = 0.5;

/** Utterances with fewer meaningful tokens than this are never removed. */
export const MISTAKE_MIN_TOKENS = 4;

/** The retry must materially continue beyond the repeated prefix. */
export const MISTAKE_MIN_CONTINUATION_TOKENS = 2;

/** A retry must start within this many seconds of the flub's end. */
export const MISTAKE_MAX_RETRY_GAP_SEC = BATCH_SEGMENT_MAX_GAP_SEC;

/** More ignored hesitation words make a textual prefix match too ambiguous. */
export const MISTAKE_MAX_IGNORED_FILLER_TOKENS = 2;

/** Bounds how far a multi-attempt restart staircase can look back. */
const MISTAKE_MAX_STAIRCASE_UTTERANCES = 8;

/** Multiple earlier attempts are required before complete thoughts may be cut. */
const MISTAKE_MIN_STAIRCASE_PRIOR_ATTEMPTS = 3;

/** Tiny restart fragments may be bridged only inside a proven staircase. */
const MISTAKE_MAX_MICRO_FRAGMENT_TOKENS = 2;

/** Repeated emphasis has one length; a staircase must show growing completion. */
const MISTAKE_MIN_STAIRCASE_DISTINCT_LENGTHS = 3;

/** Hesitation sounds ignored when comparing takes. */
const FILLER_TOKENS = new Set(['um', 'uh', 'uhm', 'umm', 'erm', 'hmm', 'hm', 'mm', 'mhm', 'er']);

/**
 * Function words and generic discourse words do not make a short opening
 * distinctive enough to delete. This is intentionally broad: false negatives
 * leave editable speech behind, while false positives discard real content.
 */
const NON_DISTINCTIVE_TOKENS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'been',
  'but',
  'by',
  'can',
  'could',
  'did',
  'do',
  'does',
  'for',
  'from',
  'had',
  'has',
  'have',
  'he',
  'her',
  'here',
  'him',
  'his',
  'how',
  'i',
  "i'll",
  "i'm",
  "i've",
  'if',
  'in',
  'is',
  'it',
  "it's",
  'just',
  'know',
  'like',
  'me',
  'mean',
  'my',
  'now',
  'of',
  'on',
  'or',
  'our',
  'really',
  'she',
  'so',
  'that',
  "that's",
  'the',
  'their',
  'them',
  'then',
  'there',
  'they',
  'this',
  'to',
  'up',
  'us',
  'was',
  'we',
  "we'll",
  "we're",
  "we've",
  'were',
  'what',
  'when',
  'where',
  'which',
  'who',
  'why',
  'will',
  'with',
  'would',
  'you',
  "you'll",
  "you're",
  "you've",
  'your'
]);

/**
 * A missing period alone is not evidence of an abandoned thought: Scribe can
 * omit punctuation, and normal speech often arrives without it. Only trailing
 * grammar that clearly expects more words (or an explicit interruption mark)
 * qualifies as incomplete.
 */
const INCOMPLETE_TRAILING_TOKENS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'because',
  'been',
  'being',
  'but',
  'by',
  'can',
  'could',
  'did',
  'do',
  'does',
  'for',
  'from',
  'had',
  'has',
  'have',
  'if',
  'in',
  'is',
  'of',
  'on',
  'or',
  'really',
  'should',
  'so',
  'than',
  'that',
  'the',
  'then',
  'to',
  'was',
  'were',
  'when',
  'where',
  'which',
  'while',
  'who',
  'will',
  'with',
  'would',
  "i'd",
  "i'll",
  "i'm",
  "we'd",
  "we'll",
  "we're",
  "you'd",
  "you'll",
  "you're"
]);

const LIST_OPENING_TOKENS = new Set([
  'first',
  'second',
  'third',
  'fourth',
  'fifth',
  'finally',
  'lastly',
  'next'
]);

export interface RemovedTake {
  /** Recording-time span of the removed abandoned attempt. */
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
  minContinuationTokens?: number;
  maxRetryGapSec?: number;
  maxIgnoredFillerTokens?: number;
}

function tokenizeComparisonText(text: string): string[] {
  return String(text || '')
    .toLowerCase()
    .replace(/[’‘]/gu, "'")
    .split(/\s+/)
    .map((token) => token.replace(/[^\p{L}\p{N}']/gu, ''))
    .filter((token) => token.length > 0);
}

/**
 * Tokenizes utterance text for comparison: lowercased, punctuation stripped
 * (apostrophes kept for contractions), hesitation fillers dropped.
 */
export function normalizeComparisonTokens(text: string): string[] {
  return tokenizeComparisonText(text).filter((token) => !FILLER_TOKENS.has(token));
}

function isExactPrefix(prefix: string[], tokens: string[]): boolean {
  return prefix.every((token, index) => token === tokens[index]);
}

function isPrefixAllowingTrailingFragment(prefix: string[], tokens: string[]): boolean {
  if (prefix.length === 0 || prefix.length > tokens.length) return false;
  return prefix.every((token, index) => {
    const target = tokens[index];
    if (token === target) return true;
    return index === prefix.length - 1 && token.length >= 2 && target.startsWith(token);
  });
}

function isDistinctivePrefix(tokens: string[]): boolean {
  const distinctiveCount = tokens.filter(
    (token) => token.length >= 4 && !NON_DISTINCTIVE_TOKENS.has(token)
  ).length;
  return tokens.length >= 5 ? distinctiveCount >= 1 : distinctiveCount >= 2;
}

function endsWithSentenceBoundary(text: string): boolean {
  return /[.!?]["')\]»”’]*\s*$/u.test(String(text || ''));
}

function startsLikeListOrQuote(text: string, tokens: string[]): boolean {
  const raw = String(text || '').trim();
  return (
    /^["'“‘«]/u.test(raw) ||
    /^(?:[-*•]|\d+[.)])\s/u.test(raw) ||
    LIST_OPENING_TOKENS.has(tokens[0] || '')
  );
}

function isClearlyIncomplete(text: string, tokens: string[]): boolean {
  if (tokens.length === 0) return false;
  const raw = String(text || '').trim();
  if (/(?:\.{2,}|…|[—–-])["')\]»”’]*$/u.test(raw)) return true;
  if (endsWithSentenceBoundary(text)) return false;
  return INCOMPLETE_TRAILING_TOKENS.has(tokens[tokens.length - 1]);
}

function hasValidSpan(segment: SpeechSegment): boolean {
  const start = Number(segment?.start);
  const end = Number(segment?.end);
  return Number.isFinite(start) && Number.isFinite(end) && end > start;
}

function hasTightRetryGap(
  candidate: SpeechSegment,
  retry: SpeechSegment,
  maxRetryGapSec: number
): boolean {
  if (!hasValidSpan(candidate) || !hasValidSpan(retry)) return false;
  const pauseSec = Number(retry.start) - Number(candidate.end);
  return pauseSec > MISTAKE_UTTERANCE_GAP_SEC && pauseSec <= maxRetryGapSec;
}

function isMicroRestartFragment(
  candidate: string[],
  retry: string[],
  fillerCount: number,
  maxIgnoredFillerTokens: number
): boolean {
  if (candidate.length === 0) {
    return fillerCount > 0 && fillerCount <= maxIgnoredFillerTokens;
  }
  return (
    candidate.length <= MISTAKE_MAX_MICRO_FRAGMENT_TOKENS &&
    isPrefixAllowingTrailingFragment(candidate, retry)
  );
}

function findStaircaseIndices({
  input,
  tokens,
  fillerCounts,
  finalIndex,
  minTokens,
  minContinuationTokens,
  maxRetryGapSec,
  maxIgnoredFillerTokens,
  removedIndices
}: {
  input: SpeechSegment[];
  tokens: string[][];
  fillerCounts: number[];
  finalIndex: number;
  minTokens: number;
  minContinuationTokens: number;
  maxRetryGapSec: number;
  maxIgnoredFillerTokens: number;
  removedIndices: Set<number>;
}): number[] {
  const finalTokens = tokens[finalIndex];
  if (
    removedIndices.has(finalIndex) ||
    !hasValidSpan(input[finalIndex]) ||
    finalTokens.length < minTokens + minContinuationTokens ||
    !isDistinctivePrefix(finalTokens) ||
    startsLikeListOrQuote(input[finalIndex].text, finalTokens)
  ) {
    return [];
  }

  const matchingAttemptIndices: number[] = [];
  const firstPossibleIndex = Math.max(0, finalIndex - MISTAKE_MAX_STAIRCASE_UTTERANCES + 1);
  for (let index = finalIndex - 1; index >= firstPossibleIndex; index -= 1) {
    if (
      removedIndices.has(index) ||
      removedIndices.has(index + 1) ||
      !hasTightRetryGap(input[index], input[index + 1], maxRetryGapSec) ||
      fillerCounts[index] + fillerCounts[finalIndex] > maxIgnoredFillerTokens
    ) {
      break;
    }

    const candidate = tokens[index];
    const isAttempt =
      candidate.length >= minTokens &&
      finalTokens.length - candidate.length >= minContinuationTokens &&
      isDistinctivePrefix(candidate) &&
      !startsLikeListOrQuote(input[index].text, candidate) &&
      isPrefixAllowingTrailingFragment(candidate, finalTokens);
    if (isAttempt) {
      matchingAttemptIndices.push(index);
      continue;
    }
    if (
      isMicroRestartFragment(candidate, finalTokens, fillerCounts[index], maxIgnoredFillerTokens)
    ) {
      continue;
    }
    break;
  }

  if (matchingAttemptIndices.length < MISTAKE_MIN_STAIRCASE_PRIOR_ATTEMPTS) return [];

  const attemptLengths = matchingAttemptIndices.map((index) => tokens[index].length);
  const distinctLengths = new Set([...attemptLengths, finalTokens.length]);
  if (distinctLengths.size < MISTAKE_MIN_STAIRCASE_DISTINCT_LENGTHS) return [];

  const oldestAttemptIndex = Math.min(...matchingAttemptIndices);
  return Array.from({ length: finalIndex - oldestAttemptIndex }, (_, offset) => {
    return oldestAttemptIndex + offset;
  });
}

/**
 * Finds abandoned prefixes among fine-grained utterances. A single restart
 * keeps the strict adjacent/incomplete rule. A bounded staircase may bridge
 * tiny matching fragments and complete punctuation only when several
 * distinctive prefixes show progressively different completion lengths.
 */
export function detectRepeatedTakes(
  utterances: SpeechSegment[],
  {
    minTokens = MISTAKE_MIN_TOKENS,
    minContinuationTokens = MISTAKE_MIN_CONTINUATION_TOKENS,
    maxRetryGapSec = MISTAKE_MAX_RETRY_GAP_SEC,
    maxIgnoredFillerTokens = MISTAKE_MAX_IGNORED_FILLER_TOKENS
  }: MistakeDetectionOptions = {}
): MistakeDetection {
  const input = Array.isArray(utterances) ? utterances : [];
  const tokens = input.map((utterance) => normalizeComparisonTokens(utterance?.text || ''));
  const fillerCounts = input.map(
    (utterance) =>
      tokenizeComparisonText(utterance?.text || '').filter((token) => FILLER_TOKENS.has(token))
        .length
  );
  const removedIndices = new Set<number>();
  const removedByIndex = new Map<number, RemovedTake>();

  const markRemoved = (index: number, retryIndex: number): void => {
    if (removedByIndex.has(index)) return;
    removedIndices.add(index);
    removedByIndex.set(index, {
      start: input[index].start,
      end: input[index].end,
      text: input[index].text,
      retryText: input[retryIndex].text
    });
  };

  for (let finalIndex = input.length - 1; finalIndex >= 1; finalIndex -= 1) {
    const staircaseIndices = findStaircaseIndices({
      input,
      tokens,
      fillerCounts,
      finalIndex,
      minTokens,
      minContinuationTokens,
      maxRetryGapSec,
      maxIgnoredFillerTokens,
      removedIndices
    });
    for (const index of staircaseIndices) {
      markRemoved(index, finalIndex);
    }
  }

  for (let i = 0; i < input.length - 1; i += 1) {
    if (removedIndices.has(i) || removedIndices.has(i + 1)) continue;
    const candidate = tokens[i];
    const retry = tokens[i + 1];
    const candidateStart = Number(input[i].start);
    const candidateEnd = Number(input[i].end);
    const retryStart = Number(input[i + 1].start);
    const retryEnd = Number(input[i + 1].end);
    const pauseSec = retryStart - candidateEnd;
    const continuationLength = retry.length - candidate.length;
    if (
      !Number.isFinite(candidateStart) ||
      !Number.isFinite(candidateEnd) ||
      !Number.isFinite(retryStart) ||
      !Number.isFinite(retryEnd) ||
      candidateEnd <= candidateStart ||
      retryEnd <= retryStart ||
      candidate.length < minTokens ||
      !isDistinctivePrefix(candidate) ||
      startsLikeListOrQuote(input[i].text, candidate) ||
      !isClearlyIncomplete(input[i].text, candidate) ||
      continuationLength < minContinuationTokens ||
      fillerCounts[i] + fillerCounts[i + 1] > maxIgnoredFillerTokens ||
      pauseSec <= MISTAKE_UTTERANCE_GAP_SEC ||
      pauseSec > maxRetryGapSec ||
      !isExactPrefix(candidate, retry)
    ) {
      continue;
    }

    markRemoved(i, i + 1);
  }

  const removed = [...removedByIndex.entries()]
    .sort(([leftIndex], [rightIndex]) => leftIndex - rightIndex)
    .map(([, take]) => take);
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
