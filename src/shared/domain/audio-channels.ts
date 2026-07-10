// Channel-balance classification for recorded audio.
//
// Mics on audio interfaces frequently deliver signal on only one channel of a
// stereo capture, which plays in one ear and sounds quiet everywhere
// downstream (editor playback, Premiere export). These helpers detect that
// "one-sided stereo" shape from per-channel RMS levels so each consumer can
// route the active channel to both ears without touching genuinely stereo or
// mono material.

/** Channels at or below this RMS level (dBFS) are treated as carrying no signal. */
export const SILENT_CHANNEL_RMS_DB = -60;

/**
 * If both channels are audible but one trails by at least this many dB, the
 * quiet one is treated as bleed/crosstalk rather than real program material.
 * Normal stereo speech or music never approaches this spread.
 */
export const ONE_SIDED_GAP_DB = 40;

export type ChannelBalance =
  | { kind: 'balanced' }
  | { kind: 'one-sided'; activeChannel: number };

const BALANCED: ChannelBalance = { kind: 'balanced' };

function isUsableLevel(value: unknown): value is number {
  // -Infinity is a valid measurement (digital silence); NaN is not.
  return typeof value === 'number' && !Number.isNaN(value);
}

/**
 * Classify a stereo capture from per-channel RMS levels in dBFS.
 *
 * Anything that is not a well-formed two-channel measurement is reported as
 * balanced: mono is already fine, and for multichannel or malformed input the
 * safe behavior is to leave the audio untouched.
 */
export function classifyChannelBalance(rmsDbPerChannel: number[]): ChannelBalance {
  if (!Array.isArray(rmsDbPerChannel) || rmsDbPerChannel.length !== 2) return BALANCED;
  const [left, right] = rmsDbPerChannel;
  if (!isUsableLevel(left) || !isUsableLevel(right)) return BALANCED;

  const leftActive = left > SILENT_CHANNEL_RMS_DB;
  const rightActive = right > SILENT_CHANNEL_RMS_DB;
  if (!leftActive && !rightActive) return BALANCED;
  if (leftActive && !rightActive) return { kind: 'one-sided', activeChannel: 0 };
  if (rightActive && !leftActive) return { kind: 'one-sided', activeChannel: 1 };

  if (left - right >= ONE_SIDED_GAP_DB) return { kind: 'one-sided', activeChannel: 0 };
  if (right - left >= ONE_SIDED_GAP_DB) return { kind: 'one-sided', activeChannel: 1 };
  return BALANCED;
}

/**
 * RMS level in dBFS of a block of float samples (-1..1). Returns -Infinity
 * for empty or all-zero input so it composes with classifyChannelBalance.
 */
export function computeRmsDb(samples: ArrayLike<number>): number {
  const length = samples.length;
  if (!length) return Number.NEGATIVE_INFINITY;
  let sumSquares = 0;
  for (let i = 0; i < length; i++) {
    const sample = samples[i];
    sumSquares += sample * sample;
  }
  const rms = Math.sqrt(sumSquares / length);
  if (!(rms > 0)) return Number.NEGATIVE_INFINITY;
  return 20 * Math.log10(rms);
}
