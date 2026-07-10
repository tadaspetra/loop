import { describe, expect, test, vi } from 'vitest';

import {
  buildChannelRmsProbeArgs,
  buildRebalancePanFilter,
  measureChannelBalance,
  parseAstatsChannelRmsDb
} from '../../src/main/services/audio-balance-service';
import { FfmpegAbortError } from '../../src/main/services/ffmpeg-runner';

const ASTATS_ONE_SIDED_LEFT =
  '[Parsed_astats_0 @ 0x600002bc4160] Channel: 1\n' +
  '[Parsed_astats_0 @ 0x600002bc4160] RMS level dB: -17.812345\n' +
  '[Parsed_astats_0 @ 0x600002bc4160] Channel: 2\n' +
  '[Parsed_astats_0 @ 0x600002bc4160] RMS level dB: -inf\n';

const ASTATS_BALANCED =
  '[Parsed_astats_0 @ 0x1] Channel: 1\n' +
  '[Parsed_astats_0 @ 0x1] RMS level dB: -21.4\n' +
  '[Parsed_astats_0 @ 0x1] Channel: 2\n' +
  '[Parsed_astats_0 @ 0x1] RMS level dB: -23.9\n';

describe('main/services/audio-balance-service', () => {
  test('buildChannelRmsProbeArgs decodes to the null muxer with per-channel astats only', () => {
    const args = buildChannelRmsProbeArgs('/tmp/audio.webm');
    const joined = args.join(' ');
    expect(args).toContain('/tmp/audio.webm');
    expect(joined).toContain('astats=measure_perchannel=RMS_level:measure_overall=none');
    expect(joined).toContain('-map 0:a:0');
    expect(joined).toContain('-vn');
    expect(joined).toContain('-f null');
  });

  test('parseAstatsChannelRmsDb extracts per-channel levels including digital silence', () => {
    expect(parseAstatsChannelRmsDb(ASTATS_ONE_SIDED_LEFT)).toEqual([
      -17.812345,
      Number.NEGATIVE_INFINITY
    ]);
    expect(parseAstatsChannelRmsDb(ASTATS_BALANCED)).toEqual([-21.4, -23.9]);
    expect(parseAstatsChannelRmsDb('no astats output here')).toEqual([]);
    expect(parseAstatsChannelRmsDb('')).toEqual([]);
  });

  test('buildRebalancePanFilter copies the active channel to both outputs', () => {
    expect(buildRebalancePanFilter({ kind: 'one-sided', activeChannel: 0 })).toBe(
      'pan=stereo|c0=c0|c1=c0'
    );
    expect(buildRebalancePanFilter({ kind: 'one-sided', activeChannel: 1 })).toBe(
      'pan=stereo|c0=c1|c1=c1'
    );
    expect(buildRebalancePanFilter({ kind: 'balanced' })).toBeNull();
  });

  test('measureChannelBalance classifies a one-sided capture from the probe output', async () => {
    let probeArgs: string[] = [];
    const runFfmpegProcess = vi.fn(async ({ args = [] }: { args?: string[] } = {}) => {
      probeArgs = args;
      return { stderr: ASTATS_ONE_SIDED_LEFT };
    });
    const balance = await measureChannelBalance({
      ffmpegPath: '/usr/bin/ffmpeg',
      inputPath: '/tmp/audio.webm',
      runFfmpegProcess
    });
    expect(balance).toEqual({ kind: 'one-sided', activeChannel: 0 });
    expect(runFfmpegProcess).toHaveBeenCalledTimes(1);
    expect(probeArgs.join(' ')).toContain('astats');
    expect(probeArgs).toContain('/tmp/audio.webm');
  });

  test('measureChannelBalance treats probe failure as balanced instead of failing the caller', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const balance = await measureChannelBalance({
        ffmpegPath: '/usr/bin/ffmpeg',
        inputPath: '/tmp/silent-screen.webm',
        runFfmpegProcess: async () => {
          throw new Error('Output file does not contain any stream');
        }
      });
      expect(balance).toEqual({ kind: 'balanced' });
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  test('measureChannelBalance rethrows aborts so cancellation still cancels', async () => {
    await expect(
      measureChannelBalance({
        ffmpegPath: '/usr/bin/ffmpeg',
        inputPath: '/tmp/audio.webm',
        runFfmpegProcess: async () => {
          throw new FfmpegAbortError();
        }
      })
    ).rejects.toBeInstanceOf(FfmpegAbortError);
  });
});
