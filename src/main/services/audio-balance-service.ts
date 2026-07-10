import {
  classifyChannelBalance,
  type ChannelBalance
} from '../../shared/domain/audio-channels';
import { FfmpegAbortError, runFfmpeg } from './ffmpeg-runner';

// Probes a media file's first audio stream for per-channel RMS levels so
// export paths can detect one-sided stereo captures (mic on one channel of a
// stereo interface) and rebalance them during transcode.

export function buildChannelRmsProbeArgs(inputPath: string): string[] {
  return [
    '-hide_banner',
    '-nostats',
    '-i',
    inputPath,
    '-map',
    '0:a:0',
    '-vn',
    // Per-channel RMS only; suppressing the Overall block keeps parsing
    // unambiguous (every reported RMS line is a channel, in order).
    '-af',
    'astats=measure_perchannel=RMS_level:measure_overall=none',
    '-f',
    'null',
    '-'
  ];
}

/**
 * Extract per-channel RMS levels (dBFS) from ffmpeg astats stderr output.
 * astats prints `-inf` for digitally silent channels.
 */
export function parseAstatsChannelRmsDb(stderr: string): number[] {
  if (typeof stderr !== 'string' || !stderr) return [];
  const levels: number[] = [];
  const pattern = /RMS level dB:\s*(-?(?:inf|\d+(?:\.\d+)?))/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(stderr)) !== null) {
    const raw = match[1];
    if (raw === 'inf') levels.push(Number.POSITIVE_INFINITY);
    else if (raw === '-inf') levels.push(Number.NEGATIVE_INFINITY);
    else levels.push(Number(raw));
  }
  return levels;
}

/** ffmpeg pan filter that routes the active channel of a one-sided capture to both ears. */
export function buildRebalancePanFilter(balance: ChannelBalance): string | null {
  if (balance.kind !== 'one-sided') return null;
  const channel = `c${balance.activeChannel}`;
  return `pan=stereo|c0=${channel}|c1=${channel}`;
}

export async function measureChannelBalance({
  ffmpegPath,
  inputPath,
  runFfmpegProcess = runFfmpeg,
  signal
}: {
  ffmpegPath: string;
  inputPath: string;
  runFfmpegProcess?: typeof runFfmpeg;
  signal?: AbortSignal;
}): Promise<ChannelBalance> {
  try {
    const { stderr } = await runFfmpegProcess({
      ffmpegPath,
      args: buildChannelRmsProbeArgs(inputPath),
      signal
    });
    return classifyChannelBalance(parseAstatsChannelRmsDb(stderr));
  } catch (error) {
    // Cancellation must still cancel the caller's whole operation.
    if (error instanceof FfmpegAbortError) throw error;
    // A failed probe (no audio stream, unreadable file) must never fail an
    // export — the worst case is simply not rebalancing that file.
    console.warn(`[audio-balance] channel probe failed for ${inputPath}:`, error);
    return { kind: 'balanced' };
  }
}
