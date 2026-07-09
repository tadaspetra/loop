/**
 * Helpers for building timeline speech segments from a batch (whole-file)
 * transcription result. Replaces the segment stream that the realtime Scribe
 * WebSocket used to emit: instead of VAD-committed chunks arriving live, the
 * full word list arrives once after recording stops and is grouped into
 * segments here.
 */

import {
  extractSpokenWordTokens,
  stripNonSpeechAnnotations,
  type TranscriptToken
} from './transcript-utils';

export interface SpeechSegment {
  start: number;
  end: number;
  text: string;
}

/**
 * Silence gap (seconds) between words that starts a new segment. Matches the
 * vad_silence_threshold_secs the realtime session used, so auto-cut sections
 * built from batch segments land on the same boundaries users are used to.
 */
export const BATCH_SEGMENT_MAX_GAP_SEC = 1.5;

export const TRANSCRIPTION_TIMEOUT_MIN_MS = 120_000;
export const TRANSCRIPTION_TIMEOUT_MAX_MS = 600_000;

/**
 * Groups batch transcription words into speech segments.
 *
 * @param words Word tokens from the batch speech-to-text response, with
 *   timestamps relative to the transcribed audio file.
 * @param offsetSec Seconds between recording start and the audio file's first
 *   sample (the per-file recorder start offset), so segment times land in
 *   recording time.
 * @param maxGapSec Silence between consecutive words that splits segments.
 */
export function buildSegmentsFromWords(
  words: TranscriptToken[],
  {
    offsetSec = 0,
    maxGapSec = BATCH_SEGMENT_MAX_GAP_SEC
  }: { offsetSec?: number; maxGapSec?: number } = {}
): SpeechSegment[] {
  const spoken = extractSpokenWordTokens(Array.isArray(words) ? words : []).filter(
    (token) =>
      typeof token.start === 'number' &&
      Number.isFinite(token.start) &&
      typeof token.end === 'number' &&
      Number.isFinite(token.end)
  );
  if (spoken.length === 0) return [];

  const groups: TranscriptToken[][] = [];
  let current: TranscriptToken[] = [];
  let previousEnd: number | null = null;

  for (const token of spoken) {
    if (previousEnd !== null && (token.start as number) - previousEnd > maxGapSec) {
      groups.push(current);
      current = [];
    }
    current.push(token);
    previousEnd = token.end as number;
  }
  if (current.length > 0) groups.push(current);

  const segments: SpeechSegment[] = [];
  for (const group of groups) {
    const text = stripNonSpeechAnnotations(group.map((token) => token.text || '').join(' '));
    if (!text) continue;
    segments.push({
      start: Math.max(0, (group[0].start as number) + offsetSec),
      end: Math.max(0, (group[group.length - 1].end as number) + offsetSec),
      text
    });
  }
  return segments;
}

/**
 * Upper bound on how long the renderer waits for a batch transcription before
 * falling back to full-duration sections. Scales with recording length
 * (batch STT is much faster than realtime, but long takes still need room),
 * clamped so a hung request can never wedge the stop flow indefinitely.
 */
export function getTranscriptionTimeoutMs(durationSec: number): number {
  const safeDuration =
    typeof durationSec === 'number' && Number.isFinite(durationSec) && durationSec > 0
      ? durationSec
      : 0;
  const scaled = safeDuration * 1000;
  return Math.min(
    TRANSCRIPTION_TIMEOUT_MAX_MS,
    Math.max(TRANSCRIPTION_TIMEOUT_MIN_MS, scaled)
  );
}
