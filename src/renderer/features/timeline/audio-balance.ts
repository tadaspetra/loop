import {
  classifyChannelBalance,
  computeRmsDb,
  type ChannelBalance
} from '../../../shared/domain/audio-channels';

// Detects one-sided stereo takes (mic on one channel of a stereo interface
// capture) from a decoded AudioBuffer so the editor can draw the waveform
// from the channel that actually carries signal and route playback of that
// channel to both ears.

export interface AudioBufferLike {
  numberOfChannels: number;
  length: number;
  getChannelData(channel: number): Float32Array;
}

const BALANCED: ChannelBalance = { kind: 'balanced' };

export function analyzeBufferChannelBalance(
  buffer: AudioBufferLike | null | undefined
): ChannelBalance {
  if (!buffer || typeof buffer.getChannelData !== 'function') return BALANCED;
  // Mono is already fine; anything beyond stereo is left untouched.
  if (buffer.numberOfChannels !== 2) return BALANCED;
  try {
    return classifyChannelBalance([
      computeRmsDb(buffer.getChannelData(0)),
      computeRmsDb(buffer.getChannelData(1))
    ]);
  } catch (_error) {
    return BALANCED;
  }
}

/** Channel to draw the waveform from: the active one when one-sided, else 0. */
export function pickWaveformChannel(balance: ChannelBalance | null | undefined): number {
  return balance && balance.kind === 'one-sided' ? balance.activeChannel : 0;
}
