export interface PeakEnvelope {
  peaks: Float32Array;
  duration: number;
  stats: {
    rawSampleReads: number;
  };
}

export interface WaveformPeakSection {
  takeId?: string | null;
  start: number;
  end: number;
  sourceStart: number;
  sourceEnd: number;
}

const DEFAULT_MAX_BUCKETS = 4096;
const DEFAULT_MIN_BUCKETS = 256;

export function resolveWaveformBucketCount({
  viewportWidth,
  zoom,
  devicePixelRatio = 1,
  minBuckets = DEFAULT_MIN_BUCKETS,
  maxBuckets = DEFAULT_MAX_BUCKETS
}: {
  viewportWidth: number;
  zoom: number;
  devicePixelRatio?: number;
  minBuckets?: number;
  maxBuckets?: number;
}): number {
  const safeWidth = Math.max(0, Number.isFinite(viewportWidth) ? viewportWidth : 0);
  const safeZoom = Math.max(1, Number.isFinite(zoom) ? zoom : 1);
  const safePixelRatio = Math.max(1, Number.isFinite(devicePixelRatio) ? devicePixelRatio : 1);
  const lowerBound = Math.max(1, Math.round(minBuckets));
  const upperBound = Math.max(lowerBound, Math.round(maxBuckets));
  return Math.max(
    lowerBound,
    Math.min(upperBound, Math.round(safeWidth * safeZoom * safePixelRatio))
  );
}

export function buildPeakEnvelope({
  samples,
  sampleRate,
  peaksPerSecond = 120,
  maxPeakCount = 120_000
}: {
  samples: Float32Array;
  sampleRate: number;
  peaksPerSecond?: number;
  maxPeakCount?: number;
}): PeakEnvelope {
  const safeSampleRate = Math.max(1, Number.isFinite(sampleRate) ? sampleRate : 1);
  const duration = samples.length / safeSampleRate;
  const requestedPeakCount = Math.ceil(
    duration * Math.max(1, Number.isFinite(peaksPerSecond) ? peaksPerSecond : 1)
  );
  const safeMaxPeakCount = Math.max(
    1,
    Number.isFinite(maxPeakCount) ? Math.round(maxPeakCount) : 120_000
  );
  const peakCount =
    samples.length === 0
      ? 0
      : Math.max(1, Math.min(samples.length, safeMaxPeakCount, requestedPeakCount));
  const peaks = new Float32Array(peakCount);

  for (let peakIndex = 0; peakIndex < peakCount; peakIndex++) {
    const startSample = Math.floor((peakIndex / peakCount) * samples.length);
    const endSample = Math.max(
      startSample + 1,
      Math.floor(((peakIndex + 1) / peakCount) * samples.length)
    );
    let maxPeak = 0;
    for (let sampleIndex = startSample; sampleIndex < endSample; sampleIndex++) {
      const absoluteSample = Math.abs(samples[sampleIndex] ?? 0);
      if (absoluteSample > maxPeak) maxPeak = absoluteSample;
    }
    peaks[peakIndex] = maxPeak;
  }

  return {
    peaks,
    duration,
    stats: {
      rawSampleReads: samples.length
    }
  };
}

export function composeTimelinePeaks({
  sections,
  totalDuration,
  envelopes,
  bucketCount
}: {
  sections: WaveformPeakSection[];
  totalDuration: number;
  envelopes: ReadonlyMap<string, PeakEnvelope>;
  bucketCount: number;
}): {
  peaks: Float32Array | null;
  stats: {
    rawSampleReads: 0;
    envelopePeakReads: number;
  };
} {
  const normalizedBucketCount = Math.max(
    1,
    Number.isFinite(bucketCount) ? Math.round(bucketCount) : DEFAULT_MIN_BUCKETS
  );
  if (!Number.isFinite(totalDuration) || totalDuration <= 0 || sections.length === 0) {
    return {
      peaks: null,
      stats: { rawSampleReads: 0, envelopePeakReads: 0 }
    };
  }

  const peaks = new Float32Array(normalizedBucketCount);
  let envelopePeakReads = 0;
  let anyData = false;
  let firstSectionIndex = 0;

  for (let bucketIndex = 0; bucketIndex < normalizedBucketCount; bucketIndex++) {
    const bucketStart = (bucketIndex / normalizedBucketCount) * totalDuration;
    const bucketEnd = ((bucketIndex + 1) / normalizedBucketCount) * totalDuration;
    while (
      firstSectionIndex < sections.length &&
      sections[firstSectionIndex].end <= bucketStart
    ) {
      firstSectionIndex++;
    }

    let maxPeak = 0;
    for (
      let sectionIndex = firstSectionIndex;
      sectionIndex < sections.length && sections[sectionIndex].start < bucketEnd;
      sectionIndex++
    ) {
      const section = sections[sectionIndex];
      const takeId = section.takeId;
      if (!takeId) continue;
      const envelope = envelopes.get(takeId);
      if (!envelope || envelope.peaks.length === 0 || envelope.duration <= 0) continue;

      const overlapStart = Math.max(bucketStart, section.start);
      const overlapEnd = Math.min(bucketEnd, section.end);
      if (overlapEnd <= overlapStart) continue;
      anyData = true;

      const sourceStart = section.sourceStart + (overlapStart - section.start);
      const sourceEnd = section.sourceStart + (overlapEnd - section.start);
      const startPeak = Math.max(
        0,
        Math.min(
          envelope.peaks.length - 1,
          Math.floor((sourceStart / envelope.duration) * envelope.peaks.length)
        )
      );
      const endPeak = Math.max(
        startPeak + 1,
        Math.min(
          envelope.peaks.length,
          Math.ceil((sourceEnd / envelope.duration) * envelope.peaks.length)
        )
      );

      for (let peakIndex = startPeak; peakIndex < endPeak; peakIndex++) {
        const peak = envelope.peaks[peakIndex];
        envelopePeakReads++;
        if (peak > maxPeak) maxPeak = peak;
      }
    }
    peaks[bucketIndex] = maxPeak;
  }

  return {
    peaks: anyData ? peaks : null,
    stats: {
      rawSampleReads: 0,
      envelopePeakReads
    }
  };
}

/**
 * Converts a decoded peak envelope into the time ranges where audible sound
 * exists: peaks above `threshold`, merged across gaps up to `maxGapSec`,
 * padded by `padSec`, and shifted by `offsetSec` into take-local time.
 * Used to protect mic-silent system audio when bad-take removal decides
 * whether a silent-looking piece is safe to trim or drop.
 */
export function deriveActiveRangesFromEnvelope({
  peaks,
  duration,
  threshold = 0.02,
  maxGapSec = 0.5,
  padSec = 0.15,
  offsetSec = 0
}: {
  peaks: Float32Array | null | undefined;
  duration: number;
  threshold?: number;
  maxGapSec?: number;
  padSec?: number;
  offsetSec?: number;
}): Array<{ start: number; end: number }> {
  const safeDuration = Math.max(0, Number.isFinite(duration) ? duration : 0);
  if (!peaks || peaks.length === 0 || safeDuration <= 0) return [];

  const secondsPerPeak = safeDuration / peaks.length;
  const ranges: Array<{ start: number; end: number }> = [];
  let activeStart = -1;
  for (let i = 0; i <= peaks.length; i++) {
    const active = i < peaks.length && peaks[i] > threshold;
    if (active && activeStart < 0) {
      activeStart = i * secondsPerPeak;
    } else if (!active && activeStart >= 0) {
      const end = i * secondsPerPeak;
      const last = ranges[ranges.length - 1];
      if (last && activeStart - last.end <= maxGapSec) {
        last.end = end;
      } else {
        ranges.push({ start: activeStart, end });
      }
      activeStart = -1;
    }
  }

  return ranges.map((range) => ({
    start: Math.max(0, range.start - padSec) + offsetSec,
    end: Math.min(safeDuration, range.end + padSec) + offsetSec
  }));
}
