/**
 * Chunking for LLM-assisted retake detection. The stored word segments are
 * grouped into sentence-sized chunks (bounded by sentence punctuation,
 * cutoff markers, and pauses) with word-precise times. The LLM only ever
 * picks among these chunk indices — it can never invent a time range — and
 * the renderer maps accepted indices back to times here.
 */

import {
  endsWithCutoffMarker,
  sanitizeSegments,
  RESTART_UNIT_GAP_SEC,
  type BadTakeRange,
  type SpeechSegmentLike
} from './restart-detection';

export interface RetakeChunk {
  index: number;
  start: number;
  end: number;
  text: string;
  /** Silence between this chunk and the next (0 for the last chunk). */
  gapAfterSec: number;
}

const SENTENCE_BOUNDARY_RE = /[.!?]["')\]»”’]*$/u;

/** Fraction of stored segments that must be single words to trust chunking. */
const WORD_LEVEL_MIN_SINGLE_WORD_FRACTION = 0.8;

/**
 * Whether the stored transcript has word-level granularity. Coarse legacy
 * transcripts (one segment per utterance) cannot be split inside a segment,
 * so a chunk could mix an abandoned attempt with its good retry — too risky
 * to offer to the LLM as an all-or-nothing removal.
 */
export function isWordLevelTranscript(
  segments: SpeechSegmentLike[] | null | undefined
): boolean {
  const sanitized = sanitizeSegments(segments);
  if (sanitized.length === 0) return false;
  const singleWordCount = sanitized.filter(
    (segment) => segment.text.split(/\s+/).length === 1
  ).length;
  return singleWordCount / sanitized.length >= WORD_LEVEL_MIN_SINGLE_WORD_FRACTION;
}

function endsWithSentencePunctuation(text: string): boolean {
  return SENTENCE_BOUNDARY_RE.test(String(text || '').trim());
}

/**
 * Groups word segments into chunks split after sentence punctuation, after
 * cutoff markers, and at pauses. Coarser legacy segments simply produce
 * coarser chunks.
 */
export function buildRetakeChunks(
  segments: SpeechSegmentLike[] | null | undefined
): RetakeChunk[] {
  const sanitized = sanitizeSegments(segments);
  const chunks: RetakeChunk[] = [];
  let current: RetakeChunk | null = null;

  for (const segment of sanitized) {
    if (current && segment.start - current.end <= RESTART_UNIT_GAP_SEC) {
      current.end = Math.max(current.end, segment.end);
      current.text = `${current.text} ${segment.text}`;
    } else {
      current = {
        index: chunks.length,
        start: segment.start,
        end: segment.end,
        text: segment.text,
        gapAfterSec: 0
      };
      chunks.push(current);
    }
    if (endsWithSentencePunctuation(segment.text) || endsWithCutoffMarker(segment.text)) {
      current = null;
    }
  }

  for (let i = 0; i < chunks.length - 1; i += 1) {
    chunks[i].gapAfterSec = Math.max(
      0,
      Number((chunks[i + 1].start - chunks[i].end).toFixed(3))
    );
  }
  return chunks;
}

/**
 * Maps LLM-chosen chunk indices back to removable time ranges. Only integer
 * indices of existing chunks are accepted, and the take's final chunk is
 * never removable — the last attempt is the one the user keeps.
 */
export function mapLlmRemovalsToRanges({
  chunks,
  removedIndices
}: {
  chunks: RetakeChunk[] | null | undefined;
  removedIndices: number[] | null | undefined;
}): BadTakeRange[] {
  const input = Array.isArray(chunks) ? chunks : [];
  if (input.length === 0 || !Array.isArray(removedIndices)) return [];

  const valid = [...new Set(removedIndices)]
    .filter(
      (index) =>
        Number.isInteger(index) && index >= 0 && index < input.length && index !== input.length - 1
    )
    .sort((left, right) => left - right);

  return valid.map((index) => ({
    start: input[index].start,
    end: input[index].end,
    text: input[index].text
  }));
}
