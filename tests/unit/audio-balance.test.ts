import { describe, expect, test } from 'vitest';

import {
  analyzeBufferChannelBalance,
  pickWaveformChannel
} from '../../src/renderer/features/timeline/audio-balance';

function makeBufferLike(channels: Float32Array[]) {
  return {
    numberOfChannels: channels.length,
    length: channels[0]?.length ?? 0,
    getChannelData(index: number) {
      return channels[index];
    }
  };
}

function sine(length: number, amplitude: number): Float32Array {
  const samples = new Float32Array(length);
  for (let i = 0; i < length; i++) samples[i] = Math.sin(i / 7) * amplitude;
  return samples;
}

describe('renderer/features/timeline/audio-balance', () => {
  test('detects a mic captured on only the left channel', () => {
    const buffer = makeBufferLike([sine(4096, 0.4), new Float32Array(4096)]);
    expect(analyzeBufferChannelBalance(buffer)).toEqual({
      kind: 'one-sided',
      activeChannel: 0
    });
  });

  test('detects a mic captured on only the right channel', () => {
    const buffer = makeBufferLike([new Float32Array(4096), sine(4096, 0.4)]);
    expect(analyzeBufferChannelBalance(buffer)).toEqual({
      kind: 'one-sided',
      activeChannel: 1
    });
  });

  test('reports balanced for normal stereo and for mono buffers', () => {
    const stereo = makeBufferLike([sine(4096, 0.4), sine(4096, 0.3)]);
    expect(analyzeBufferChannelBalance(stereo)).toEqual({ kind: 'balanced' });

    const mono = makeBufferLike([sine(4096, 0.4)]);
    expect(analyzeBufferChannelBalance(mono)).toEqual({ kind: 'balanced' });
  });

  test('reports balanced for missing or malformed buffers', () => {
    expect(analyzeBufferChannelBalance(null)).toEqual({ kind: 'balanced' });
    expect(analyzeBufferChannelBalance(undefined)).toEqual({ kind: 'balanced' });
    expect(
      analyzeBufferChannelBalance({ numberOfChannels: 2 } as never)
    ).toEqual({ kind: 'balanced' });
  });

  test('pickWaveformChannel returns the active channel for one-sided audio, else channel 0', () => {
    expect(pickWaveformChannel({ kind: 'one-sided', activeChannel: 1 })).toBe(1);
    expect(pickWaveformChannel({ kind: 'one-sided', activeChannel: 0 })).toBe(0);
    expect(pickWaveformChannel({ kind: 'balanced' })).toBe(0);
    expect(pickWaveformChannel(null)).toBe(0);
    expect(pickWaveformChannel(undefined)).toBe(0);
  });
});
