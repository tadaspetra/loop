/**
 * Section normalization and remap helpers for the timeline.
 */

import { normalizeTranscriptText } from '../transcript/transcript-utils.js';

export const TRIM_PADDING = 0.15;

/**
 * Rounds a numeric value to 3 decimal places (millisecond precision).
 * @param {number} value
 * @returns {number}
 */
export function roundMs(value) {
  return Number(value.toFixed(3));
}

/**
 * Builds remapped sections from speech segments (padding, merge, timeline mapping).
 * @param {Array<{start: number, end: number, text?: string}>} segments
 * @returns {Array<{id: string, index: number, sourceStart: number, sourceEnd: number, start: number, end: number, duration: number, transcript: string}>}
 */
export function buildRemappedSectionsFromSegments(segments) {
  if (!Array.isArray(segments) || segments.length === 0) return [];

  const padded = segments
    .map((segment) => {
      const rawStart = Number(segment.start);
      const rawEnd = Number(segment.end);
      if (!Number.isFinite(rawStart) || !Number.isFinite(rawEnd)) return null;
      const start = Math.max(0, rawStart - TRIM_PADDING);
      const end = Math.max(start, rawEnd + TRIM_PADDING);
      return {
        start,
        end,
        transcript: normalizeTranscriptText(segment.text)
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.start - b.start);

  if (padded.length === 0) return [];

  const merged = [{
    start: padded[0].start,
    end: padded[0].end,
    transcripts: padded[0].transcript ? [padded[0].transcript] : []
  }];
  for (let i = 1; i < padded.length; i++) {
    const last = merged[merged.length - 1];
    if (padded[i].start <= last.end) {
      last.end = Math.max(last.end, padded[i].end);
      if (padded[i].transcript) last.transcripts.push(padded[i].transcript);
    } else {
      merged.push({
        start: padded[i].start,
        end: padded[i].end,
        transcripts: padded[i].transcript ? [padded[i].transcript] : []
      });
    }
  }

  const remapped = [];
  let timelineCursor = 0;
  for (let i = 0; i < merged.length; i++) {
    const segment = merged[i];
    const sourceStart = roundMs(segment.start);
    const sourceEnd = roundMs(segment.end);
    const duration = Math.max(0, sourceEnd - sourceStart);
    const start = roundMs(timelineCursor);
    const end = roundMs(timelineCursor + duration);
    remapped.push({
      id: `section-${i + 1}`,
      index: i,
      sourceStart,
      sourceEnd,
      start,
      end,
      duration: roundMs(duration),
      transcript: normalizeTranscriptText(segment.transcripts.join(' '))
    });
    timelineCursor += duration;
  }

  return remapped;
}

/**
 * Normalizes raw sections: validates times, clamps to duration, adds index/label/duration.
 * @param {Array} rawSections
 * @param {number} duration
 * @returns {Array}
 */
export function normalizeSections(rawSections, duration) {
  const safeDuration = Math.max(0, Number(duration) || 0);
  const input = Array.isArray(rawSections) ? rawSections : [];
  const baseSections = input.length > 0
    ? input
    : (safeDuration > 0 ? [{ id: 'section-1', start: 0, end: safeDuration }] : []);

  const normalized = baseSections
    .map((section, idx) => {
      let start = Number(section.start);
      let end = Number(section.end);
      if (!Number.isFinite(start)) start = 0;
      if (!Number.isFinite(end)) end = start;
      const transcript = normalizeTranscriptText(
        typeof section.transcript === 'string'
          ? section.transcript
          : (typeof section.text === 'string' ? section.text : '')
      );
      start = Math.max(0, start);
      end = Math.max(start, end);

      if (safeDuration > 0) {
        start = Math.min(start, safeDuration);
        end = Math.min(end, safeDuration);
      }

      return {
        id: section.id || `section-${idx + 1}`,
        sourceStart: Number.isFinite(Number(section.sourceStart)) ? Number(section.sourceStart) : start,
        sourceEnd: Number.isFinite(Number(section.sourceEnd)) ? Number(section.sourceEnd) : end,
        start: roundMs(start),
        end: roundMs(end),
        takeId: typeof section.takeId === 'string' && section.takeId ? section.takeId : null,
        transcript,
        saved: !!section.saved
      };
    })
    .filter(section => section.end - section.start > 0.0001)
    .sort((a, b) => a.start - b.start);

  if (normalized.length === 0) return [];

  if (safeDuration > 0) {
    const last = normalized[normalized.length - 1];
    const drift = Math.abs(safeDuration - last.end);
    if (drift <= 0.2) {
      last.end = roundMs(safeDuration);
    }
  }

  for (let i = 0; i < normalized.length; i++) {
    normalized[i].index = i;
    normalized[i].label = `Section ${i + 1}`;
    normalized[i].duration = roundMs(Math.max(0, normalized[i].end - normalized[i].start));
  }

  return normalized;
}

/**
 * Builds a single default section spanning the full duration.
 * @param {number} duration
 * @returns {Array}
 */
export function buildDefaultSectionsForDuration(duration) {
  const safeDuration = Math.max(0, Number(duration) || 0);
  if (safeDuration <= 0) return [];
  return [{
    id: 'section-1',
    index: 0,
    label: 'Section 1',
    sourceStart: 0,
    sourceEnd: roundMs(safeDuration),
    start: 0,
    end: roundMs(safeDuration),
    duration: roundMs(safeDuration),
    transcript: ''
  }];
}

/**
 * Normalizes sections or falls back to a single default section.
 * @param {Array} rawSections
 * @param {number} duration
 * @returns {Array}
 */
export function normalizeTakeSections(rawSections, duration) {
  const normalized = normalizeSections(rawSections, duration);
  if (normalized.length > 0) return normalized;
  return buildDefaultSectionsForDuration(duration);
}

/**
 * Attaches transcript text to sections by index or source time overlap.
 * @param {Array} sections
 * @param {Array} transcriptSections
 * @returns {Array}
 */
export function attachSectionTranscripts(sections, transcriptSections) {
  const baseSections = Array.isArray(sections) ? sections : [];
  const transcriptSource = Array.isArray(transcriptSections) ? transcriptSections : [];

  return baseSections.map((section, index) => {
    const existing = normalizeTranscriptText(
      typeof section.transcript === 'string'
        ? section.transcript
        : (typeof section.text === 'string' ? section.text : '')
    );
    if (existing) {
      return { ...section, transcript: existing };
    }

    const byIndex = transcriptSource[index];
    let transcript = normalizeTranscriptText(byIndex?.transcript || byIndex?.text || '');

    if (!transcript) {
      const sourceStart = Number(section.sourceStart);
      const sourceEnd = Number(section.sourceEnd);
      if (Number.isFinite(sourceStart) && Number.isFinite(sourceEnd)) {
        const bySource = transcriptSource.find((candidate) => {
          const candidateStart = Number(candidate?.sourceStart);
          const candidateEnd = Number(candidate?.sourceEnd);
          return Number.isFinite(candidateStart)
            && Number.isFinite(candidateEnd)
            && Math.abs(candidateStart - sourceStart) <= 0.05
            && Math.abs(candidateEnd - sourceEnd) <= 0.05;
        });
        transcript = normalizeTranscriptText(bySource?.transcript || bySource?.text || '');
      }
    }

    return { ...section, transcript };
  });
}
