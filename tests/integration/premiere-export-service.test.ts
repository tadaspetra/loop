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

function makeBaseOpts(tmpDir: string, opts: Partial<PremiereExportOptions> = {}): PremiereExportOptions {
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
    cameraSyncOffsetMs: 0,
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
        cameraSyncOffsetMs: 0,
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
        if (outPath && outPath.endsWith('.mov')) {
          fs.mkdirSync(path.dirname(outPath), { recursive: true });
          fs.writeFileSync(outPath, 'prores-data', 'utf8');
        }
      })
    });

    expect(calls).toHaveLength(2);
    const allArgs = calls.map((c) => c.args.join(' '));
    expect(allArgs.some((a) => a.includes('screen-take-1.mov'))).toBe(true);
    expect(allArgs.some((a) => a.includes('camera-take-1.mov'))).toBe(true);

    for (const call of calls) {
      const joined = call.args.join(' ');
      expect(joined).toContain('-c:v prores_ks');
      expect(joined).toContain('-profile:v 1');
      expect(joined).toContain('-pix_fmt yuv422p10le');
    }

    // Camera filter must only hflip (no center-crop) so native dims survive.
    const cameraCall = calls.find((c) => c.args.join(' ').includes('camera-take-1.mov'));
    expect(cameraCall).toBeDefined();
    const cameraFilters = cameraCall!.args.join(' ');
    expect(cameraFilters).toContain('hflip');
    expect(cameraFilters).not.toContain('crop=');

    // Screen transcode must not apply any scaling filter (native resolution preserved).
    const screenCall = calls.find((c) => c.args.join(' ').includes('screen-take-1.mov'));
    expect(screenCall).toBeDefined();
    expect(screenCall!.args).not.toContain('-vf');

    const xmlPath = path.join(opts.outputFolder, 'My Project.xml');
    expect(fs.existsSync(xmlPath)).toBe(true);
    const xml = fs.readFileSync(xmlPath, 'utf8');
    expect(xml).toContain('<xmeml version="5">');
    expect(xml).toContain('My Project');
    expect(xml).toContain('screen-take-1.mov');
    expect(xml).toContain('camera-take-1.mov');
    // Sequence adopts the probed native screen dimensions (3840x2160), not a cap.
    expect(xml).toContain('<width>3840</width>');
    expect(xml).toContain('<height>2160</height>');
    // Camera asset recorded at native 1920x1080 (not square).
    expect(xml).toContain('<width>1920</width>');
    expect(xml).toContain('<height>1080</height>');
    expect(result.xmlPath).toBe(xmlPath);
    expect(result.outputFolder).toBe(opts.outputFolder);
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
        if (outPath && outPath.endsWith('.mov')) {
          fs.mkdirSync(path.dirname(outPath), { recursive: true });
          fs.writeFileSync(outPath, 'prores-data', 'utf8');
        }
      })
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].args.join(' ')).toContain('screen-take-1.mov');
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
        onProgress?.({ status: 'end', outTimeSec: 4, frame: null, speed: null, fps: null, raw: {} });
        const outPath = args[args.length - 1];
        if (outPath && outPath.endsWith('.mov')) {
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
        if (outPath && outPath.endsWith('.mov')) {
          fs.mkdirSync(path.dirname(outPath), { recursive: true });
          fs.writeFileSync(outPath, 'prores-data', 'utf8');
        }
      })
    });

    expect(calls).toHaveLength(2);
  });
});
