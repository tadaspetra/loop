import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, test } from 'vitest';

import {
  exportPremiereProject,
  type PremiereExportOptions,
  type PremiereExportDeps
} from '../../src/main/services/premiere-export-service';
import type { Keyframe } from '../../src/shared/domain/project';

type FfmpegCall = { args: string[] };

function createRunFfmpegStub(
  calls: FfmpegCall[],
  onCall?: (call: FfmpegCall) => void
): NonNullable<PremiereExportDeps['runFfmpeg']> {
  return async ({ args = [] } = {}) => {
    const call = { args };
    calls.push(call);
    if (onCall) onCall(call);
    return { stderr: '' };
  };
}

function isChannelProbeCall(call: FfmpegCall): boolean {
  return call.args.join(' ').includes('astats');
}

function astatsStderr(leftRmsDb: string, rightRmsDb: string): string {
  return (
    '[Parsed_astats_0 @ 0x1] Channel: 1\n' +
    `[Parsed_astats_0 @ 0x1] RMS level dB: ${leftRmsDb}\n` +
    '[Parsed_astats_0 @ 0x1] Channel: 2\n' +
    `[Parsed_astats_0 @ 0x1] RMS level dB: ${rightRmsDb}\n`
  );
}

/**
 * Stub that answers channel probes with per-input astats output and materializes
 * transcode outputs on disk like the plain stub does.
 */
function createProbeAwareRunFfmpegStub(
  calls: FfmpegCall[],
  probeStderrByInput: Record<string, string | Error>
): NonNullable<PremiereExportDeps['runFfmpeg']> {
  return async ({ args = [] } = {}) => {
    const call = { args };
    calls.push(call);
    if (isChannelProbeCall(call)) {
      const inputIndex = args.indexOf('-i');
      const inputPath = inputIndex >= 0 ? args[inputIndex + 1] : '';
      const entry = Object.entries(probeStderrByInput).find(([key]) =>
        inputPath.includes(key)
      );
      const response = entry?.[1] ?? astatsStderr('-20.0', '-21.0');
      if (response instanceof Error) throw response;
      return { stderr: response };
    }
    const outPath = args[args.length - 1];
    if (outPath && (outPath.endsWith('.mp4') || outPath.endsWith('.wav'))) {
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, 'media-data', 'utf8');
    }
    return { stderr: '' };
  };
}

function baseKeyframe(overrides: Partial<Keyframe> = {}): Keyframe {
  return {
    time: 0,
    pipX: 100,
    pipY: 100,
    pipVisible: true,
    cameraFullscreen: false,
    backgroundZoom: 1,
    backgroundPanX: 0,
    backgroundPanY: 0,
    sectionId: null,
    autoSection: false,
    ...overrides
  };
}

function makeBaseOpts(
  tmpDir: string,
  opts: Partial<PremiereExportOptions> = {}
): PremiereExportOptions {
  const screenPath = path.join(tmpDir, 'screen.webm');
  const cameraPath = path.join(tmpDir, 'camera.webm');
  fs.writeFileSync(screenPath, 'screen', 'utf8');
  fs.writeFileSync(cameraPath, 'camera', 'utf8');

  return {
    outputFolder: path.join(tmpDir, 'out'),
    projectName: 'My Project',
    pipSize: 422,
    sourceWidth: 1920,
    sourceHeight: 1080,
    takes: [
      {
        id: 'take-1',
        screenPath,
        cameraPath,
        duration: 10
      }
    ],
    sections: [
      {
        takeId: 'take-1',
        timelineStart: 0,
        timelineEnd: 4,
        sourceStart: 0,
        sourceEnd: 4
      }
    ],
    keyframes: [baseKeyframe({ time: 0 }), baseKeyframe({ time: 2, pipX: 800 })],
    ...opts
  };
}

describe('main/services/premiere-export-service', () => {
  test('exportPremiereProject validates inputs', async () => {
    await expect(
      exportPremiereProject({
        outputFolder: '',
        projectName: 'x',
        pipSize: 422,
        sourceWidth: 1920,
        sourceHeight: 1080,
        takes: [],
        sections: [],
        keyframes: []
      })
    ).rejects.toThrow(/Missing output folder/);
  });

  test('exportPremiereProject transcodes screen and camera for each take and writes XML', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'premiere-export-'));
    const calls: FfmpegCall[] = [];
    const opts = makeBaseOpts(tmpDir);

    const result = await exportPremiereProject(opts, {
      ffmpegPath: '/usr/bin/ffmpeg',
      probeVideoFpsWithFfmpeg: async () => 30,
      probeVideoDimensionsWithFfmpeg: async (_path, filePath) => {
        if (String(filePath).includes('camera')) return { width: 1920, height: 1080 };
        return { width: 3840, height: 2160 };
      },
      runFfmpeg: createRunFfmpegStub(calls, (call) => {
        const outPath = call.args[call.args.length - 1];
        if (outPath && outPath.endsWith('.mp4')) {
          fs.mkdirSync(path.dirname(outPath), { recursive: true });
          fs.writeFileSync(outPath, 'mp4-data', 'utf8');
        }
      })
    });

    // Legacy takes default to mic-on-screen, so the screen input gets one
    // channel-balance probe before the two transcodes.
    const transcodeCalls = calls.filter((c) => !isChannelProbeCall(c));
    expect(calls.filter(isChannelProbeCall)).toHaveLength(1);
    expect(transcodeCalls).toHaveLength(2);
    const allArgs = transcodeCalls.map((c) => c.args.join(' '));
    expect(allArgs.some((a) => a.includes('screen-take-1.mp4'))).toBe(true);
    expect(allArgs.some((a) => a.includes('camera-take-1.mp4'))).toBe(true);

    // Both transcodes must be H.264 MP4 (smaller than ProRes) and force CFR
    // so VFR WebM sources don't balloon the output duration / file size.
    for (const call of transcodeCalls) {
      const joined = call.args.join(' ');
      expect(joined).toContain('-c:v libx264');
      expect(joined).toContain('-crf 18');
      expect(joined).toContain('-pix_fmt yuv420p');
      expect(joined).toContain('-fps_mode cfr');
      expect(joined).toContain('fps=30');
      expect(joined).toContain('-movflags +faststart');
      expect(joined).not.toContain('prores_ks');
    }

    // Camera filter hflip + fps + setsar (no center-crop so native dims survive).
    const cameraCall = calls.find((c) => c.args.join(' ').includes('camera-take-1.mp4'));
    expect(cameraCall).toBeDefined();
    const cameraFilters = cameraCall!.args.join(' ');
    expect(cameraFilters).toContain('hflip,fps=30,setsar=1');
    expect(cameraFilters).not.toContain('crop=');

    // Screen transcode normalizes to CFR via fps filter (no scaling).
    const screenCall = calls.find((c) => c.args.join(' ').includes('screen-take-1.mp4'));
    expect(screenCall).toBeDefined();
    const screenJoined = screenCall!.args.join(' ');
    expect(screenJoined).toContain('-vf fps=30,setsar=1');

    const xmlPath = path.join(opts.outputFolder, 'My Project.xml');
    expect(fs.existsSync(xmlPath)).toBe(true);
    const xml = fs.readFileSync(xmlPath, 'utf8');
    expect(xml).toContain('<xmeml version="5">');
    expect(xml).toContain('My Project');
    expect(xml).toContain('screen-take-1.mp4');
    expect(xml).toContain('camera-take-1.mp4');

    // Sequence is authored at 1080p (matches the editor's 1920x1080 preview
    // space) regardless of the 3840x2160 screen capture, so PiP/overlay
    // geometry maps 1:1 and the project opens as a 1080p timeline. The
    // sequence dimensions live in the only <format> block in the document
    // (file assets declare bare <samplecharacteristics> with no <format>).
    const seqFormatMatch = xml.match(
      /<format>\s*<samplecharacteristics>[\s\S]*?<width>(\d+)<\/width>\s*<height>(\d+)<\/height>/
    );
    expect(seqFormatMatch).not.toBeNull();
    expect(seqFormatMatch![1]).toBe('1920');
    expect(seqFormatMatch![2]).toBe('1080');

    // The screen media is preserved at its native 3840x2160 resolution (full
    // quality) and scaled to cover the 1080p sequence via Motion.
    expect(xml).toContain('<width>3840</width>');
    expect(xml).toContain('<height>2160</height>');

    // Screen clip carries a Basic Motion fit scale of 50% (1920/3840) so the
    // 4K capture fills the 1080p frame.
    expect(xml).toMatch(
      /<parameterid>scale<\/parameterid>\s*<name>Scale<\/name>[\s\S]*?<value>50\.000<\/value>/
    );

    expect(result.xmlPath).toBe(xmlPath);
    expect(result.outputFolder).toBe(opts.outputFolder);
  });

  test('exportPremiereProject writes the screen transform placement into the XML', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'premiere-export-transform-'));
    const calls: FfmpegCall[] = [];
    const opts = makeBaseOpts(tmpDir, {
      // Half-fit 4K capture centered in the top-left quadrant of the 16:9
      // sequence, exactly as placed in the editor.
      screenTransform: { x: 480, y: 270, scale: 0.5 },
      keyframes: [baseKeyframe({ time: 0, pipVisible: false })]
    });

    await exportPremiereProject(opts, {
      ffmpegPath: '/usr/bin/ffmpeg',
      probeVideoFpsWithFfmpeg: async () => 30,
      probeVideoDimensionsWithFfmpeg: async () => ({ width: 3840, height: 2160 }),
      runFfmpeg: createRunFfmpegStub(calls, (call) => {
        const outPath = call.args[call.args.length - 1];
        if (outPath && outPath.endsWith('.mp4')) {
          fs.mkdirSync(path.dirname(outPath), { recursive: true });
          fs.writeFileSync(outPath, 'mp4-data', 'utf8');
        }
      })
    });

    const xml = fs.readFileSync(path.join(opts.outputFolder, 'My Project.xml'), 'utf8');
    // Placement width 960 over native 3840 → 25% Motion scale, centered at
    // (480, 270): a (-480, -270) px offset in media units (3840×2160) →
    // (-0.125, -0.125) in Premiere's media-relative center units.
    expect(xml).toMatch(
      /<parameterid>scale<\/parameterid>\s*<name>Scale<\/name>[\s\S]*?<value>25\.000<\/value>/
    );
    expect(xml).toContain('<horiz>-0.125000</horiz>');
    expect(xml).toContain('<vert>-0.125000</vert>');
  });

  test('exportPremiereProject skips camera transcode when take has no camera', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'premiere-export-nocam-'));
    const calls: FfmpegCall[] = [];
    const opts = makeBaseOpts(tmpDir, {
      takes: [
        {
          id: 'take-1',
          screenPath: path.join(tmpDir, 'screen.webm'),
          cameraPath: null,
          duration: 10
        }
      ],
      keyframes: [baseKeyframe({ pipVisible: false, cameraFullscreen: false })]
    });
    fs.writeFileSync(opts.takes[0].screenPath, 'screen', 'utf8');

    await exportPremiereProject(opts, {
      ffmpegPath: '/usr/bin/ffmpeg',
      probeVideoFpsWithFfmpeg: async () => 30,
      probeVideoDimensionsWithFfmpeg: async () => ({ width: 1920, height: 1080 }),
      runFfmpeg: createRunFfmpegStub(calls, (call) => {
        const outPath = call.args[call.args.length - 1];
        if (outPath && outPath.endsWith('.mp4')) {
          fs.mkdirSync(path.dirname(outPath), { recursive: true });
          fs.writeFileSync(outPath, 'prores-data', 'utf8');
        }
      })
    });

    const transcodeCalls = calls.filter((c) => !isChannelProbeCall(c));
    expect(transcodeCalls).toHaveLength(1);
    expect(transcodeCalls[0].args.join(' ')).toContain('screen-take-1.mp4');
  });

  test('exportPremiereProject resolves project-relative media paths from the project folder', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'premiere-export-relative-'));
    const calls: FfmpegCall[] = [];
    fs.writeFileSync(path.join(tmpDir, 'screen-a.webm'), 'screen-a', 'utf8');
    fs.writeFileSync(path.join(tmpDir, 'camera-a.webm'), 'camera-a', 'utf8');
    fs.writeFileSync(path.join(tmpDir, 'screen-b.webm'), 'screen-b', 'utf8');
    const opts = makeBaseOpts(tmpDir, {
      projectFolder: tmpDir,
      takes: [
        {
          id: 'take-a',
          screenPath: 'screen-a.webm',
          cameraPath: 'camera-a.webm',
          audioSource: 'camera',
          duration: 10
        },
        {
          id: 'take-b',
          screenPath: 'screen-b.webm',
          cameraPath: null,
          audioSource: null,
          duration: 12
        }
      ],
      sections: [
        { takeId: 'take-a', timelineStart: 0, timelineEnd: 4, sourceStart: 0, sourceEnd: 4 },
        { takeId: 'take-b', timelineStart: 4, timelineEnd: 8, sourceStart: 1, sourceEnd: 5 }
      ],
      keyframes: [
        baseKeyframe({ time: 0, pipVisible: true }),
        baseKeyframe({ time: 4, pipVisible: true })
      ]
    });

    await exportPremiereProject(opts, {
      ffmpegPath: '/usr/bin/ffmpeg',
      probeVideoFpsWithFfmpeg: async () => 30,
      probeVideoDimensionsWithFfmpeg: async () => ({ width: 1920, height: 1080 }),
      runFfmpeg: createRunFfmpegStub(calls, (call) => {
        const outPath = call.args[call.args.length - 1];
        if (outPath && outPath.endsWith('.mp4')) {
          fs.mkdirSync(path.dirname(outPath), { recursive: true });
          fs.writeFileSync(outPath, 'mp4-data', 'utf8');
        }
      })
    });

    const joinedCalls = calls.map((call) => call.args.join(' '));
    // 3 transcodes plus channel probes for the audio-carrying inputs: take-a's
    // camera (owns the mic) and take-b's screen (legacy mic-on-screen default).
    expect(calls.filter((c) => !isChannelProbeCall(c))).toHaveLength(3);
    expect(joinedCalls).toEqual(
      expect.arrayContaining([
        expect.stringContaining(path.join(tmpDir, 'screen-a.webm')),
        expect.stringContaining(path.join(tmpDir, 'camera-a.webm')),
        expect.stringContaining(path.join(tmpDir, 'screen-b.webm'))
      ])
    );
    expect(joinedCalls.some((call) => call.includes('camera-take-b.mp4'))).toBe(false);
  });

  test('exportPremiereProject emits progress updates across transcodes', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'premiere-export-progress-'));
    const calls: FfmpegCall[] = [];
    const updates: { phase?: string; percent?: number | null; status?: string }[] = [];
    const opts = makeBaseOpts(tmpDir);

    await exportPremiereProject(opts, {
      ffmpegPath: '/usr/bin/ffmpeg',
      probeVideoFpsWithFfmpeg: async () => 30,
      probeVideoDimensionsWithFfmpeg: async () => ({ width: 1920, height: 1080 }),
      runFfmpeg: async (runOpts = {}) => {
        const args = runOpts.args || [];
        const onProgress = runOpts.onProgress;
        calls.push({ args });
        onProgress?.({
          status: 'continue',
          outTimeSec: 2,
          frame: null,
          speed: null,
          fps: null,
          raw: {}
        });
        onProgress?.({
          status: 'end',
          outTimeSec: 4,
          frame: null,
          speed: null,
          fps: null,
          raw: {}
        });
        const outPath = args[args.length - 1];
        if (outPath && outPath.endsWith('.mp4')) {
          fs.mkdirSync(path.dirname(outPath), { recursive: true });
          fs.writeFileSync(outPath, 'prores-data', 'utf8');
        }
        return { stderr: '' };
      },
      onProgress: (u) => updates.push(u)
    });

    expect(updates.length).toBeGreaterThan(0);
    expect(updates[0].phase).toBe('starting');
    expect(updates.some((u) => u.phase === 'transcoding')).toBe(true);
    expect(updates.some((u) => u.phase === 'finalizing' && u.percent === 1)).toBe(true);
  });

  test('exportPremiereProject rebalances a one-sided external mic during transcode', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'premiere-export-onesided-'));
    const calls: FfmpegCall[] = [];
    const audioPath = path.join(tmpDir, 'mic.webm');
    fs.writeFileSync(audioPath, 'mic', 'utf8');
    const opts = makeBaseOpts(tmpDir, {
      takes: [
        {
          id: 'take-1',
          screenPath: path.join(tmpDir, 'screen.webm'),
          cameraPath: null,
          audioPath,
          audioSource: 'external',
          duration: 10
        }
      ],
      keyframes: [baseKeyframe({ pipVisible: false, cameraFullscreen: false })]
    });

    await exportPremiereProject(opts, {
      ffmpegPath: '/usr/bin/ffmpeg',
      probeVideoFpsWithFfmpeg: async () => 30,
      probeVideoDimensionsWithFfmpeg: async () => ({ width: 1920, height: 1080 }),
      // Mic landed on the RIGHT channel of the stereo capture.
      runFfmpeg: createProbeAwareRunFfmpegStub(calls, {
        'mic.webm': astatsStderr('-inf', '-16.3')
      })
    });

    // Only the mic file carries audio for this take (screen has neither the
    // mic nor system audio), so exactly one channel probe runs.
    const probeCalls = calls.filter(isChannelProbeCall);
    expect(probeCalls).toHaveLength(1);
    expect(probeCalls[0].args.join(' ')).toContain(audioPath);

    const wavCall = calls.find((c) => c.args.join(' ').includes('audio-take-1.wav'));
    expect(wavCall).toBeDefined();
    expect(wavCall!.args.join(' ')).toContain('-af pan=stereo|c0=c1|c1=c1');

    const screenCall = calls.find((c) => c.args.join(' ').includes('screen-take-1.mp4'));
    expect(screenCall!.args.join(' ')).not.toContain('pan=');
  });

  test('exportPremiereProject leaves balanced stereo audio untouched', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'premiere-export-balanced-'));
    const calls: FfmpegCall[] = [];
    const audioPath = path.join(tmpDir, 'mic.webm');
    fs.writeFileSync(audioPath, 'mic', 'utf8');
    const opts = makeBaseOpts(tmpDir, {
      takes: [
        {
          id: 'take-1',
          screenPath: path.join(tmpDir, 'screen.webm'),
          cameraPath: null,
          audioPath,
          audioSource: 'external',
          duration: 10
        }
      ],
      keyframes: [baseKeyframe({ pipVisible: false, cameraFullscreen: false })]
    });

    await exportPremiereProject(opts, {
      ffmpegPath: '/usr/bin/ffmpeg',
      probeVideoFpsWithFfmpeg: async () => 30,
      probeVideoDimensionsWithFfmpeg: async () => ({ width: 1920, height: 1080 }),
      runFfmpeg: createProbeAwareRunFfmpegStub(calls, {
        'mic.webm': astatsStderr('-19.2', '-20.8')
      })
    });

    for (const call of calls) {
      expect(call.args.join(' ')).not.toContain('pan=');
    }
  });

  test('exportPremiereProject probes camera and system-audio inputs and rebalances per file', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'premiere-export-multi-'));
    const calls: FfmpegCall[] = [];
    const opts = makeBaseOpts(tmpDir, {
      takes: [
        {
          id: 'take-1',
          screenPath: path.join(tmpDir, 'screen.webm'),
          cameraPath: path.join(tmpDir, 'camera.webm'),
          audioSource: 'camera',
          hasSystemAudio: true,
          duration: 10
        }
      ]
    });

    await exportPremiereProject(opts, {
      ffmpegPath: '/usr/bin/ffmpeg',
      probeVideoFpsWithFfmpeg: async () => 30,
      probeVideoDimensionsWithFfmpeg: async () => ({ width: 1920, height: 1080 }),
      runFfmpeg: createProbeAwareRunFfmpegStub(calls, {
        // Camera mic sits on the LEFT channel; system audio is proper stereo.
        'camera.webm': astatsStderr('-15.1', '-inf'),
        'screen.webm': astatsStderr('-22.4', '-23.0')
      })
    });

    const probeCalls = calls.filter(isChannelProbeCall);
    const probedInputs = probeCalls.map((c) => c.args[c.args.indexOf('-i') + 1]);
    expect(probedInputs).toHaveLength(2);
    expect(probedInputs.some((p) => p.includes('camera.webm'))).toBe(true);
    expect(probedInputs.some((p) => p.includes('screen.webm'))).toBe(true);

    const cameraCall = calls.find((c) => c.args.join(' ').includes('camera-take-1.mp4'));
    expect(cameraCall!.args.join(' ')).toContain('-af pan=stereo|c0=c0|c1=c0');
    const screenCall = calls.find((c) => c.args.join(' ').includes('screen-take-1.mp4'));
    expect(screenCall!.args.join(' ')).not.toContain('pan=');
  });

  test('exportPremiereProject still succeeds when the channel probe fails', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'premiere-export-probefail-'));
    const calls: FfmpegCall[] = [];
    const audioPath = path.join(tmpDir, 'mic.webm');
    fs.writeFileSync(audioPath, 'mic', 'utf8');
    const opts = makeBaseOpts(tmpDir, {
      takes: [
        {
          id: 'take-1',
          screenPath: path.join(tmpDir, 'screen.webm'),
          cameraPath: null,
          audioPath,
          audioSource: 'external',
          duration: 10
        }
      ],
      keyframes: [baseKeyframe({ pipVisible: false, cameraFullscreen: false })]
    });

    const result = await exportPremiereProject(opts, {
      ffmpegPath: '/usr/bin/ffmpeg',
      probeVideoFpsWithFfmpeg: async () => 30,
      probeVideoDimensionsWithFfmpeg: async () => ({ width: 1920, height: 1080 }),
      runFfmpeg: createProbeAwareRunFfmpegStub(calls, {
        'mic.webm': new Error('could not decode audio')
      })
    });

    expect(fs.existsSync(result.xmlPath)).toBe(true);
    const wavCall = calls.find((c) => c.args.join(' ').includes('audio-take-1.wav'));
    expect(wavCall).toBeDefined();
    expect(wavCall!.args.join(' ')).not.toContain('pan=');
  });

  test('exportPremiereProject dedupes ffmpeg jobs for repeated takes across sections', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'premiere-export-dedupe-'));
    const calls: FfmpegCall[] = [];
    const opts = makeBaseOpts(tmpDir, {
      sections: [
        { takeId: 'take-1', timelineStart: 0, timelineEnd: 2, sourceStart: 0, sourceEnd: 2 },
        { takeId: 'take-1', timelineStart: 2, timelineEnd: 4, sourceStart: 5, sourceEnd: 7 }
      ]
    });

    await exportPremiereProject(opts, {
      ffmpegPath: '/usr/bin/ffmpeg',
      probeVideoFpsWithFfmpeg: async () => 30,
      probeVideoDimensionsWithFfmpeg: async () => ({ width: 1920, height: 1080 }),
      runFfmpeg: createRunFfmpegStub(calls, (call) => {
        const outPath = call.args[call.args.length - 1];
        if (outPath && outPath.endsWith('.mp4')) {
          fs.mkdirSync(path.dirname(outPath), { recursive: true });
          fs.writeFileSync(outPath, 'prores-data', 'utf8');
        }
      })
    });

    // One screen probe + one screen transcode + one camera transcode: repeated
    // sections over the same take must not re-probe or re-transcode.
    expect(calls.filter(isChannelProbeCall)).toHaveLength(1);
    expect(calls.filter((c) => !isChannelProbeCall(c))).toHaveLength(2);
  });
});
