import { describe, expect, test } from 'vitest';

import {
  classifyChannelBalance,
  computeRmsDb,
  ONE_SIDED_GAP_DB,
  SILENT_CHANNEL_RMS_DB
} from '../../src/shared/domain/audio-channels';

describe('shared/domain/audio-channels', () => {
  describe('classifyChannelBalance', () => {
    test('reports one-sided left when the right channel is digitally silent', () => {
      expect(classifyChannelBalance([-18.5, Number.NEGATIVE_INFINITY])).toEqual({
        kind: 'one-sided',
        activeChannel: 0
      });
    });

    test('reports one-sided right when the left channel is below the silence floor', () => {
      expect(classifyChannelBalance([SILENT_CHANNEL_RMS_DB - 5, -14.2])).toEqual({
        kind: 'one-sided',
        activeChannel: 1
      });
    });

    test('reports one-sided when both channels are audible but one dominates by the gap', () => {
      // e.g. crosstalk bleed from an interface: mic at -16, bleed at -58.
      expect(classifyChannelBalance([-16, -16 - ONE_SIDED_GAP_DB])).toEqual({
        kind: 'one-sided',
        activeChannel: 0
      });
      expect(classifyChannelBalance([-59.5, -18])).toEqual({
        kind: 'one-sided',
        activeChannel: 1
      });
    });

    test('reports balanced for normal stereo content', () => {
      expect(classifyChannelBalance([-20.1, -21.3])).toEqual({ kind: 'balanced' });
      expect(classifyChannelBalance([-20, -45])).toEqual({ kind: 'balanced' });
    });

    test('reports balanced when both channels are silent', () => {
      expect(
        classifyChannelBalance([Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY])
      ).toEqual({ kind: 'balanced' });
      expect(classifyChannelBalance([-80, -95])).toEqual({ kind: 'balanced' });
    });

    test('reports balanced for mono, multichannel, or malformed input', () => {
      expect(classifyChannelBalance([-20])).toEqual({ kind: 'balanced' });
      expect(classifyChannelBalance([-20, -21, -22])).toEqual({ kind: 'balanced' });
      expect(classifyChannelBalance([])).toEqual({ kind: 'balanced' });
      expect(classifyChannelBalance([Number.NaN, -20])).toEqual({ kind: 'balanced' });
      expect(
        classifyChannelBalance(['-20', -20] as unknown as number[])
      ).toEqual({ kind: 'balanced' });
      expect(classifyChannelBalance(null as unknown as number[])).toEqual({ kind: 'balanced' });
    });
  });

  describe('computeRmsDb', () => {
    test('returns -Infinity for empty or all-zero samples', () => {
      expect(computeRmsDb(new Float32Array(0))).toBe(Number.NEGATIVE_INFINITY);
      expect(computeRmsDb(new Float32Array(1024))).toBe(Number.NEGATIVE_INFINITY);
    });

    test('returns 0 dB for a full-scale square wave', () => {
      const samples = new Float32Array(512);
      for (let i = 0; i < samples.length; i++) samples[i] = i % 2 === 0 ? 1 : -1;
      expect(computeRmsDb(samples)).toBeCloseTo(0, 5);
    });

    test('returns about -6 dB for a half-scale square wave', () => {
      const samples = new Float32Array(512).fill(0.5);
      expect(computeRmsDb(samples)).toBeCloseTo(20 * Math.log10(0.5), 5);
    });

    test('classifies a synthetic one-sided pair end to end', () => {
      const active = new Float32Array(2048);
      for (let i = 0; i < active.length; i++) active[i] = Math.sin(i / 10) * 0.4;
      const silent = new Float32Array(2048);
      const balance = classifyChannelBalance([computeRmsDb(active), computeRmsDb(silent)]);
      expect(balance).toEqual({ kind: 'one-sided', activeChannel: 0 });
    });
  });
});
