import { describe, expect, test } from 'vitest';

import {
  buildPeakEnvelope,
  composeTimelinePeaks,
  deriveActiveRangesFromEnvelope,
  resolveWaveformBucketCount
} from '../../src/renderer/features/timeline/waveform-peaks';

describe('renderer/features/timeline/waveform-peaks', () => {
  test('caps zoom detail using viewport pixels', () => {
    expect(resolveWaveformBucketCount({ viewportWidth: 800, zoom: 1 })).toBe(800);
    expect(resolveWaveformBucketCount({ viewportWidth: 800, zoom: 50 })).toBe(4096);
    expect(resolveWaveformBucketCount({ viewportWidth: 0, zoom: 1 })).toBe(256);
  });

  test('scans raw samples once then composes zoom levels from a bounded envelope', () => {
    const samples = new Float32Array(1_000_000);
    samples[125_000] = -0.8;
    samples[750_000] = 0.6;

    const envelope = buildPeakEnvelope({
      samples,
      sampleRate: 10_000,
      peaksPerSecond: 100,
      maxPeakCount: 12_000
    });

    expect(envelope.stats.rawSampleReads).toBe(1_000_000);
    expect(envelope.peaks.length).toBe(10_000);

    const composed = composeTimelinePeaks({
      sections: [
        {
          takeId: 'take-1',
          start: 0,
          end: 100,
          sourceStart: 0,
          sourceEnd: 100
        }
      ],
      totalDuration: 100,
      envelopes: new Map([['take-1', envelope]]),
      bucketCount: 4096
    });

    expect(composed.peaks).not.toBeNull();
    expect(composed.stats.rawSampleReads).toBe(0);
    expect(composed.stats.envelopePeakReads).toBeLessThanOrEqual(14_096);
    expect(Math.max(...(composed.peaks ?? []))).toBeCloseTo(0.8);
  });

  test('maps trimmed timeline sections onto source envelopes', () => {
    const envelope = buildPeakEnvelope({
      samples: Float32Array.from([0.1, 0.2, 0.9, 0.4]),
      sampleRate: 1,
      peaksPerSecond: 1
    });

    const composed = composeTimelinePeaks({
      sections: [
        {
          takeId: 'take-1',
          start: 0,
          end: 2,
          sourceStart: 1,
          sourceEnd: 3
        }
      ],
      totalDuration: 2,
      envelopes: new Map([['take-1', envelope]]),
      bucketCount: 2
    });

    expect(Array.from(composed.peaks ?? [])).toEqual([
      expect.closeTo(0.2),
      expect.closeTo(0.9)
    ]);
  });

  describe('deriveActiveRangesFromEnvelope', () => {
    test('returns padded ranges where the envelope is above the threshold', () => {
      // 10s envelope at 10 peaks/sec: sound from 2.0-4.0s and 7.0-7.5s.
      const peaks = new Float32Array(100);
      for (let i = 20; i < 40; i++) peaks[i] = 0.5;
      for (let i = 70; i < 75; i++) peaks[i] = 0.3;

      const ranges = deriveActiveRangesFromEnvelope({ peaks, duration: 10 });
      expect(ranges).toHaveLength(2);
      expect(ranges[0].start).toBeCloseTo(1.85, 2);
      expect(ranges[0].end).toBeCloseTo(4.15, 2);
      expect(ranges[1].start).toBeCloseTo(6.85, 2);
      expect(ranges[1].end).toBeCloseTo(7.65, 2);
    });

    test('merges activity across short gaps and applies the time offset', () => {
      // Sound at 1.0-2.0s and 2.3-3.0s (0.3s gap) with a 0.5s file offset.
      const peaks = new Float32Array(100);
      for (let i = 10; i < 20; i++) peaks[i] = 0.4;
      for (let i = 23; i < 30; i++) peaks[i] = 0.4;

      const ranges = deriveActiveRangesFromEnvelope({
        peaks,
        duration: 10,
        offsetSec: 0.5
      });
      expect(ranges).toHaveLength(1);
      expect(ranges[0].start).toBeCloseTo(1.35, 2);
      expect(ranges[0].end).toBeCloseTo(3.65, 2);
    });

    test('ignores noise below the threshold and handles empty input', () => {
      const noise = new Float32Array(100).fill(0.005);
      expect(deriveActiveRangesFromEnvelope({ peaks: noise, duration: 10 })).toEqual([]);
      expect(
        deriveActiveRangesFromEnvelope({ peaks: new Float32Array(0), duration: 0 })
      ).toEqual([]);
    });
  });
});
