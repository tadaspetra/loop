import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, test } from 'vitest';

import {
  assertFilePath,
  computeShiftedTrimWindow,
  normalizeSectionInput,
  renderComposite,
  type RenderCompositeDeps
} from '../../src/main/services/render-service';
import type { FfmpegProgress } from '../../src/main/services/ffmpeg-runner';
import type { Keyframe } from '../../src/shared/domain/project';

type RunFfmpegCall = {
  ffmpegPath: string;
  args: string[];
  onProgress?: (progress: FfmpegProgress) => void;
};

function createRunFfmpegStub(
  effect: (call: RunFfmpegCall) => void | Promise<void> = async () => {}
): NonNullable<RenderCompositeDeps['runFfmpeg']> {
  return async ({ ffmpegPath = '', args = [], onProgress } = {}) => {
    await effect({ ffmpegPath, args, onProgress });
    return { stderr: '' };
  };
}

describe('main/services/render-service', () => {
  test('normalizeSectionInput filters invalid sections', () => {
    const sections = normalizeSectionInput([
      {
        takeId: 'a',
        sourceStart: 0,
        sourceEnd: 1,
        backgroundZoom: 1.75,
        backgroundPanX: 0.5,
        backgroundPanY: -0.3
      },
      { takeId: 'b', sourceStart: 2, sourceEnd: 1 },
      { takeId: 'c', sourceStart: 'x', sourceEnd: 3 },
      {
        takeId: 'd',
        sourceStart: 0,
        sourceEnd: 2,
        backgroundZoom: 10,
        backgroundPanX: -9,
        backgroundPanY: 8
      }
    ]);

    expect(sections).toHaveLength(2);
    expect(sections[0].takeId).toBe('a');
    expect(sections[0].backgroundZoom).toBe(1.75);
    expect(sections[0].backgroundPanX).toBe(0.5);
    expect(sections[0].backgroundPanY).toBe(-0.3);
    expect(sections[1].backgroundZoom).toBe(3);
    expect(sections[1].backgroundPanX).toBe(-1);
    expect(sections[1].backgroundPanY).toBe(1);
  });

  test('normalizeSectionInput preserves imagePath and defaults to null', () => {
    const sections = normalizeSectionInput([
      { takeId: 'a', sourceStart: 0, sourceEnd: 1, imagePath: '/tmp/photo.png' },
      { takeId: 'b', sourceStart: 2, sourceEnd: 4 },
      { takeId: 'c', sourceStart: 5, sourceEnd: 7, imagePath: '' }
    ]);

    expect(sections).toHaveLength(3);
    expect(sections[0].imagePath).toBe('/tmp/photo.png');
    expect(sections[1].imagePath).toBeNull();
    expect(sections[2].imagePath).toBeNull();
  });

  test('assertFilePath throws for missing files and accepts existing file', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'video-render-test-'));
    const file = path.join(tmpDir, 'input.webm');
    fs.writeFileSync(file, 'x', 'utf8');

    expect(() => assertFilePath(file, 'Screen')).not.toThrow();
    expect(() => assertFilePath(path.join(tmpDir, 'missing.webm'), 'Screen')).toThrow(
      /Screen file not found/
    );
  });

  test('renderComposite validates required output and sections', async () => {
    await expect(renderComposite({ outputFolder: '', sections: [] })).rejects.toThrow(
      /Missing output folder/
    );
    await expect(renderComposite({ outputFolder: '/tmp', sections: [] })).rejects.toThrow(
      /No sections to render/
    );
  });

  test('renderComposite rejects unknown takes', async () => {
    await expect(
      renderComposite(
        {
          outputFolder: '/tmp',
          takes: [],
          sections: [{ takeId: 'missing', sourceStart: 0, sourceEnd: 1 }],
          keyframes: []
        },
        {
          ffmpegPath: '/usr/bin/ffmpeg',
          probeVideoFpsWithFfmpeg: async () => 30,
          runFfmpeg: createRunFfmpegStub()
        }
      )
    ).rejects.toThrow(/Take missing not found/);
  });

  test('renderComposite builds ffmpeg args and resolves output path', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'video-render-run-'));
    const outputDir = path.join(tmpDir, 'out');
    const screenPath = path.join(tmpDir, 'screen.webm');
    fs.writeFileSync(screenPath, 'screen', 'utf8');

    const execCalls: { bin: string; args: string[] }[] = [];
    const output = await renderComposite(
      {
        outputFolder: outputDir,
        takes: [{ id: 'take-1', screenPath, cameraPath: null }],
        sections: [{ takeId: 'take-1', sourceStart: 0, sourceEnd: 1.25 }],
        keyframes: [
          { time: 0, pipX: 10, pipY: 10, pipVisible: false, cameraFullscreen: false }
        ] as Keyframe[],
        pipSize: 300,
        sourceWidth: 1920,
        sourceHeight: 1080,
        screenFitMode: 'fill'
      },
      {
        ffmpegPath: '/usr/bin/ffmpeg',
        now: () => 123,
        probeVideoFpsWithFfmpeg: async () => 29.97,
        runFfmpeg: createRunFfmpegStub(({ ffmpegPath, args }) => {
          execCalls.push({ bin: ffmpegPath, args });
        })
      }
    );

    expect(output).toBe(path.join(outputDir, 'recording-123-edited.mp4'));
    expect(execCalls).toHaveLength(1);
    expect(execCalls[0].bin).toBe('/usr/bin/ffmpeg');
    expect(execCalls[0].args.join(' ')).toContain('-filter_complex');
    expect(execCalls[0].args.join(' ')).toContain('[audio_out]acompressor=');
    expect(execCalls[0].args.join(' ')).toContain('-map [audio_final]');
    expect(execCalls[0].args).toEqual(expect.arrayContaining(['-fflags', '+genpts']));
    expect(execCalls[0].args).not.toContain('-r');
    expect(execCalls[0].args).toEqual(
      expect.arrayContaining([
        '-progress',
        'pipe:1',
        '-nostats',
        '-c:v',
        'libx264',
        '-crf',
        '8',
        '-preset',
        'slow',
        '-g',
        '60',
        '-pix_fmt',
        'yuv420p',
        '-c:a',
        'aac',
        '-b:a',
        '192k'
      ])
    );
  });

  test('renderComposite uses fast export preset for faster sanity-check renders', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'video-render-fast-preset-'));
    const outputDir = path.join(tmpDir, 'out');
    const screenPath = path.join(tmpDir, 'screen.webm');
    const cameraPath = path.join(tmpDir, 'camera.webm');
    fs.writeFileSync(screenPath, 'screen', 'utf8');
    fs.writeFileSync(cameraPath, 'camera', 'utf8');

    const execCalls: { bin: string; args: string[] }[] = [];
    await renderComposite(
      {
        outputFolder: outputDir,
        takes: [{ id: 'take-1', screenPath, cameraPath }],
        sections: [{ takeId: 'take-1', sourceStart: 0, sourceEnd: 1.0 }],
        keyframes: [
          { time: 0, pipX: 1478, pipY: 638, pipVisible: true, cameraFullscreen: false }
        ] as Keyframe[],
        pipSize: 422,
        sourceWidth: 3840,
        sourceHeight: 2160,
        screenFitMode: 'fill',
        exportVideoPreset: 'fast'
      },
      {
        ffmpegPath: '/usr/bin/ffmpeg',
        now: () => 124,
        probeVideoFpsWithFfmpeg: async () => 30,
        runFfmpeg: createRunFfmpegStub(({ ffmpegPath, args }) => {
          execCalls.push({ bin: ffmpegPath, args });
        })
      }
    );

    expect(execCalls[0].args).toEqual(
      expect.arrayContaining([
        '-c:v',
        'libx264',
        '-crf',
        '24',
        '-preset',
        'veryfast',
        '-g',
        '60',
        '-pix_fmt',
        'yuv420p',
        '-b:a',
        '128k'
      ])
    );

    const argString = execCalls[0].args.join(' ');
    expect(argString).toContain(
      'scale=1280:720:flags=lanczos:force_original_aspect_ratio=increase,crop=1280:720[screen]'
    );
    expect(argString).toContain('scale=280:280');
    expect(argString).toContain("overlay=x='985':y='425'");
  });

  test('renderComposite keeps default audio mapping when export audio preset is off', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'video-render-audio-off-'));
    const outputDir = path.join(tmpDir, 'out');
    const screenPath = path.join(tmpDir, 'screen.webm');
    fs.writeFileSync(screenPath, 'screen', 'utf8');

    const execCalls: { bin: string; args: string[] }[] = [];
    await renderComposite(
      {
        outputFolder: outputDir,
        takes: [{ id: 'take-1', screenPath, cameraPath: null }],
        sections: [{ takeId: 'take-1', sourceStart: 0, sourceEnd: 1.25 }],
        keyframes: [
          { time: 0, pipX: 10, pipY: 10, pipVisible: false, cameraFullscreen: false }
        ] as Keyframe[],
        pipSize: 300,
        sourceWidth: 1920,
        sourceHeight: 1080,
        screenFitMode: 'fill',
        exportAudioPreset: 'off'
      },
      {
        ffmpegPath: '/usr/bin/ffmpeg',
        now: () => 321,
        probeVideoFpsWithFfmpeg: async () => 30,
        runFfmpeg: createRunFfmpegStub(({ ffmpegPath, args }) => {
          execCalls.push({ bin: ffmpegPath, args });
        })
      }
    );

    const argString = execCalls[0].args.join(' ');
    // Concat now emits [screen_concat][audio_out]; the fps=N step after the
    // concat promotes it to [screen_raw]. The 'off' audio preset still maps
    // audio_out directly to the output (no compressor).
    expect(argString).toContain('[screen_concat][audio_out]');
    expect(argString).toContain('[screen_concat]fps=30,setsar=1[screen_raw]');
    expect(argString).toContain('-map [audio_out]');
    expect(argString).not.toContain('acompressor=');
    expect(argString).not.toContain('[audio_final]');
  });

  test('renderComposite applies compressor filter when export audio preset is compressed', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'video-render-audio-compressed-'));
    const outputDir = path.join(tmpDir, 'out');
    const screenPath = path.join(tmpDir, 'screen.webm');
    fs.writeFileSync(screenPath, 'screen', 'utf8');

    const execCalls: { bin: string; args: string[] }[] = [];
    await renderComposite(
      {
        outputFolder: outputDir,
        takes: [{ id: 'take-1', screenPath, cameraPath: null }],
        sections: [{ takeId: 'take-1', sourceStart: 0, sourceEnd: 1.25 }],
        keyframes: [
          { time: 0, pipX: 10, pipY: 10, pipVisible: false, cameraFullscreen: false }
        ] as Keyframe[],
        pipSize: 300,
        sourceWidth: 1920,
        sourceHeight: 1080,
        screenFitMode: 'fill',
        exportAudioPreset: 'compressed'
      },
      {
        ffmpegPath: '/usr/bin/ffmpeg',
        now: () => 654,
        probeVideoFpsWithFfmpeg: async () => 30,
        runFfmpeg: createRunFfmpegStub(({ ffmpegPath, args }) => {
          execCalls.push({ bin: ffmpegPath, args });
        })
      }
    );

    const argString = execCalls[0].args.join(' ');
    expect(argString).toContain('[audio_out]acompressor=');
    expect(argString).toContain('[audio_final]');
    expect(argString).toContain('-map [audio_final]');
  });

  test('renderComposite applies section zoom to background only', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'video-render-zoom-'));
    const outputDir = path.join(tmpDir, 'out');
    const screenPath = path.join(tmpDir, 'screen.webm');
    const cameraPath = path.join(tmpDir, 'camera.webm');
    fs.writeFileSync(screenPath, 'screen', 'utf8');
    fs.writeFileSync(cameraPath, 'camera', 'utf8');

    const execCalls: { bin: string; args: string[] }[] = [];
    await renderComposite(
      {
        outputFolder: outputDir,
        takes: [{ id: 'take-1', screenPath, cameraPath }],
        sections: [{ takeId: 'take-1', sourceStart: 0, sourceEnd: 1.0, backgroundZoom: 2 }],
        keyframes: [
          {
            time: 0,
            pipX: 10,
            pipY: 10,
            pipVisible: true,
            cameraFullscreen: false,
            backgroundZoom: 2,
            backgroundPanX: 0,
            backgroundPanY: 0
          }
        ] as Keyframe[],
        pipSize: 300,
        sourceWidth: 1920,
        sourceHeight: 1080,
        screenFitMode: 'fill'
      },
      {
        ffmpegPath: '/usr/bin/ffmpeg',
        now: () => 456,
        probeVideoFpsWithFfmpeg: async () => 30,
        runFfmpeg: createRunFfmpegStub(({ ffmpegPath, args }) => {
          execCalls.push({ bin: ffmpegPath, args });
        })
      }
    );

    const argString = execCalls[0].args.join(' ');
    expect(argString).toContain(
      "[screen_raw]scale=1920:1080:flags=lanczos:force_original_aspect_ratio=increase,crop=1920:1080[screen_base];[screen_base]zoompan=z='2.000'"
    );
    // Every section's video trim ends with a tpad safety-pad + trim=duration
    // cap so the section's video length is EXACTLY the section's nominal
    // duration, even if the VFR source produced a few frames fewer than
    // expected. Without this, multi-section exports drifted audio-ahead
    // of video over time because `atrim` is sample-accurate while bare
    // `trim` on VFR quietly loses a frame-or-two per section.
    expect(argString).toContain(
      '[1:v]trim=start=0.000:end=1.000,setpts=PTS-STARTPTS,tpad=start_mode=clone:start_duration=0.000:stop_mode=clone:stop_duration=0.250,trim=duration=1.000,setpts=PTS-STARTPTS[cv0]'
    );
    expect(argString).toContain('[cv0]concat=n=1:v=1:a=0[camera_concat]');
    expect(argString).toContain('[camera_concat]fps=30,setsar=1[camera_raw]');
    expect(argString).not.toContain('scale=3840:2160,crop=1920:1080:960:540[cv0]');
  });

  test('renderComposite caps larger sources at 1440p and scales pip layout', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'video-render-4k-export-'));
    const outputDir = path.join(tmpDir, 'out');
    const screenPath = path.join(tmpDir, 'screen.webm');
    const cameraPath = path.join(tmpDir, 'camera.webm');
    fs.writeFileSync(screenPath, 'screen', 'utf8');
    fs.writeFileSync(cameraPath, 'camera', 'utf8');

    const execCalls: { bin: string; args: string[] }[] = [];
    await renderComposite(
      {
        outputFolder: outputDir,
        takes: [{ id: 'take-1', screenPath, cameraPath }],
        sections: [{ takeId: 'take-1', sourceStart: 0, sourceEnd: 1.0 }],
        keyframes: [
          { time: 0, pipX: 1478, pipY: 638, pipVisible: true, cameraFullscreen: false }
        ] as Keyframe[],
        pipSize: 422,
        sourceWidth: 3840,
        sourceHeight: 2160,
        screenFitMode: 'fill'
      },
      {
        ffmpegPath: '/usr/bin/ffmpeg',
        now: () => 457,
        probeVideoFpsWithFfmpeg: async () => 30,
        runFfmpeg: createRunFfmpegStub(({ ffmpegPath, args }) => {
          execCalls.push({ bin: ffmpegPath, args });
        })
      }
    );

    const argString = execCalls[0].args.join(' ');
    expect(argString).toContain(
      'scale=2560:1440:flags=lanczos:force_original_aspect_ratio=increase,crop=2560:1440[screen]'
    );
    expect(argString).toContain('scale=562:562');
    expect(argString).toContain("overlay=x='1971':y='851'");
  });

  test('renderComposite keeps minimum 1080p export for smaller sources', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'video-render-min-1080p-'));
    const outputDir = path.join(tmpDir, 'out');
    const screenPath = path.join(tmpDir, 'screen.webm');
    fs.writeFileSync(screenPath, 'screen', 'utf8');

    const execCalls: { bin: string; args: string[] }[] = [];
    await renderComposite(
      {
        outputFolder: outputDir,
        takes: [{ id: 'take-1', screenPath, cameraPath: null }],
        sections: [{ takeId: 'take-1', sourceStart: 0, sourceEnd: 1.0 }],
        keyframes: [
          { time: 0, pipX: 10, pipY: 10, pipVisible: false, cameraFullscreen: false }
        ] as Keyframe[],
        pipSize: 300,
        sourceWidth: 1510,
        sourceHeight: 982,
        screenFitMode: 'fill'
      },
      {
        ffmpegPath: '/usr/bin/ffmpeg',
        now: () => 458,
        probeVideoFpsWithFfmpeg: async () => 30,
        runFfmpeg: createRunFfmpegStub(({ ffmpegPath, args }) => {
          execCalls.push({ bin: ffmpegPath, args });
        })
      }
    );

    const argString = execCalls[0].args.join(' ');
    expect(argString).toContain(
      'scale=1920:1080:flags=lanczos:force_original_aspect_ratio=increase,crop=1920:1080[out]'
    );
    expect(argString).not.toContain('scale=1510:982');
  });

  test('renderComposite advances camera video when camera sync offset is positive', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'video-render-camera-sync-'));
    const outputDir = path.join(tmpDir, 'out');
    const screenPath = path.join(tmpDir, 'screen.webm');
    const cameraPath = path.join(tmpDir, 'camera.webm');
    fs.writeFileSync(screenPath, 'screen', 'utf8');
    fs.writeFileSync(cameraPath, 'camera', 'utf8');

    const execCalls: { bin: string; args: string[] }[] = [];
    await renderComposite(
      {
        outputFolder: outputDir,
        takes: [{ id: 'take-1', screenPath, cameraPath }],
        sections: [{ takeId: 'take-1', sourceStart: 0, sourceEnd: 1.0 }],
        keyframes: [
          { time: 0, pipX: 10, pipY: 10, pipVisible: true, cameraFullscreen: false }
        ] as Keyframe[],
        pipSize: 300,
        sourceWidth: 1920,
        sourceHeight: 1080,
        screenFitMode: 'fill',
        cameraSyncOffsetMs: 120
      },
      {
        ffmpegPath: '/usr/bin/ffmpeg',
        now: () => 147,
        probeVideoFpsWithFfmpeg: async () => 30,
        runFfmpeg: createRunFfmpegStub(({ ffmpegPath, args }) => {
          execCalls.push({ bin: ffmpegPath, args });
        })
      }
    );

    const argString = execCalls[0].args.join(' ');
    // User camera sync offset shifts the sample window (no per-section fps
    // anymore — that's applied once after the concat so multi-section
    // trimmed durations do not drift). The tail stop_duration is the shift
    // (0.120s) PLUS the constant 0.250s safety pad that locks every
    // section's video length to the nominal section duration.
    expect(argString).toContain(
      '[1:v]trim=start=0.120:end=1.120,setpts=PTS-STARTPTS,tpad=start_mode=clone:start_duration=0.000:stop_mode=clone:stop_duration=0.370,trim=duration=1.000,setpts=PTS-STARTPTS[cv0]'
    );
  });

  test('renderComposite applies clamped section pan to background crop', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'video-render-pan-'));
    const outputDir = path.join(tmpDir, 'out');
    const screenPath = path.join(tmpDir, 'screen.webm');
    fs.writeFileSync(screenPath, 'screen', 'utf8');

    const execCalls: { bin: string; args: string[] }[] = [];
    await renderComposite(
      {
        outputFolder: outputDir,
        takes: [{ id: 'take-1', screenPath, cameraPath: null }],
        sections: [
          {
            takeId: 'take-1',
            sourceStart: 0,
            sourceEnd: 1.0,
            backgroundZoom: 2,
            backgroundPanX: 1,
            backgroundPanY: -1
          }
        ],
        keyframes: [
          {
            time: 0,
            pipX: 10,
            pipY: 10,
            pipVisible: false,
            cameraFullscreen: false,
            backgroundZoom: 2,
            backgroundPanX: 1,
            backgroundPanY: -1
          }
        ] as Keyframe[],
        pipSize: 300,
        sourceWidth: 1920,
        sourceHeight: 1080,
        screenFitMode: 'fill'
      },
      {
        ffmpegPath: '/usr/bin/ffmpeg',
        now: () => 789,
        probeVideoFpsWithFfmpeg: async () => 30,
        runFfmpeg: createRunFfmpegStub(({ ffmpegPath, args }) => {
          execCalls.push({ bin: ffmpegPath, args });
        })
      }
    );

    const argString = execCalls[0].args.join(' ');
    expect(argString).toContain(
      "zoompan=z='2.000':x='max(0,min(iw-iw/zoom,iw*(0.750000)-iw/zoom/2))':y='max(0,min(ih-ih/zoom,ih*(0.250000)-ih/zoom/2))'"
    );
  });

  test('renderComposite animates background zoom and pan through section boundaries', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'video-render-animated-bg-'));
    const outputDir = path.join(tmpDir, 'out');
    const screenPath = path.join(tmpDir, 'screen.webm');
    fs.writeFileSync(screenPath, 'screen', 'utf8');

    const execCalls: { bin: string; args: string[] }[] = [];
    await renderComposite(
      {
        outputFolder: outputDir,
        takes: [{ id: 'take-1', screenPath, cameraPath: null }],
        sections: [
          {
            takeId: 'take-1',
            sourceStart: 0,
            sourceEnd: 1.0,
            backgroundZoom: 1,
            backgroundPanX: 0,
            backgroundPanY: 0
          },
          {
            takeId: 'take-1',
            sourceStart: 1.0,
            sourceEnd: 2.0,
            backgroundZoom: 2,
            backgroundPanX: 1,
            backgroundPanY: -1
          }
        ],
        keyframes: [
          {
            time: 0,
            pipX: 10,
            pipY: 10,
            pipVisible: false,
            cameraFullscreen: false,
            backgroundZoom: 1,
            backgroundPanX: 0,
            backgroundPanY: 0
          },
          {
            time: 1,
            pipX: 10,
            pipY: 10,
            pipVisible: false,
            cameraFullscreen: false,
            backgroundZoom: 2,
            backgroundPanX: 1,
            backgroundPanY: -1
          }
        ] as Keyframe[],
        pipSize: 300,
        sourceWidth: 1920,
        sourceHeight: 1080,
        screenFitMode: 'fill'
      },
      {
        ffmpegPath: '/usr/bin/ffmpeg',
        now: () => 999,
        probeVideoFpsWithFfmpeg: async () => 30,
        runFfmpeg: createRunFfmpegStub(({ ffmpegPath, args }) => {
          execCalls.push({ bin: ffmpegPath, args });
        })
      }
    );

    const argString = execCalls[0].args.join(' ');
    expect(argString).toContain('if(gte(it,1.000),2.000');
    expect(argString).toContain('if(gte(it,0.700),1.000+1.000*if(lt(');
    expect(argString).toContain('pow(');
  });

  test('renderComposite reuses ffmpeg inputs for repeated sections from the same take', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'video-render-dedupe-'));
    const outputDir = path.join(tmpDir, 'out');
    const screenPath = path.join(tmpDir, 'screen.webm');
    const cameraPath = path.join(tmpDir, 'camera.webm');
    fs.writeFileSync(screenPath, 'screen', 'utf8');
    fs.writeFileSync(cameraPath, 'camera', 'utf8');

    const execCalls: { bin: string; args: string[] }[] = [];
    await renderComposite(
      {
        outputFolder: outputDir,
        takes: [{ id: 'take-1', screenPath, cameraPath }],
        sections: [
          { takeId: 'take-1', sourceStart: 0, sourceEnd: 1.0 },
          { takeId: 'take-1', sourceStart: 1.0, sourceEnd: 2.0 }
        ],
        keyframes: [
          { time: 0, pipX: 10, pipY: 10, pipVisible: true, cameraFullscreen: false }
        ] as Keyframe[],
        pipSize: 300,
        sourceWidth: 1920,
        sourceHeight: 1080,
        screenFitMode: 'fill'
      },
      {
        ffmpegPath: '/usr/bin/ffmpeg',
        now: () => 222,
        probeVideoFpsWithFfmpeg: async () => 30,
        runFfmpeg: createRunFfmpegStub(({ ffmpegPath, args }) => {
          execCalls.push({ bin: ffmpegPath, args });
        })
      }
    );

    const args = execCalls[0].args;
    expect(args.filter((value) => value === '-i')).toHaveLength(2);
    expect(args.filter((value) => value === screenPath)).toHaveLength(1);
    expect(args.filter((value) => value === cameraPath)).toHaveLength(1);

    const argString = args.join(' ');
    // Every section trim locks its output to the nominal duration via a
    // tpad safety pad + trim=duration cap. Without this, VFR sources
    // quietly produce shorter-than-nominal video per section, causing
    // multi-section exports to drift audio against video over time.
    expect(argString).toContain(
      '[0:v]trim=start=0.000:end=1.000,setpts=PTS-STARTPTS,tpad=start_mode=clone:start_duration=0.000:stop_mode=clone:stop_duration=0.250,trim=duration=1.000,setpts=PTS-STARTPTS,setsar=1[sv0]'
    );
    expect(argString).toContain(
      '[0:v]trim=start=1.000:end=2.000,setpts=PTS-STARTPTS,tpad=start_mode=clone:start_duration=0.000:stop_mode=clone:stop_duration=0.250,trim=duration=1.000,setpts=PTS-STARTPTS,setsar=1[sv1]'
    );
    expect(argString).toContain(
      '[1:v]trim=start=0.000:end=1.000,setpts=PTS-STARTPTS,tpad=start_mode=clone:start_duration=0.000:stop_mode=clone:stop_duration=0.250,trim=duration=1.000,setpts=PTS-STARTPTS[cv0]'
    );
    expect(argString).toContain(
      '[1:v]trim=start=1.000:end=2.000,setpts=PTS-STARTPTS,tpad=start_mode=clone:start_duration=0.000:stop_mode=clone:stop_duration=0.250,trim=duration=1.000,setpts=PTS-STARTPTS[cv1]'
    );
    expect(argString).toContain('concat=n=2:v=1:a=1[screen_concat][audio_out]');
    expect(argString).toContain('[screen_concat]fps=30,setsar=1[screen_raw]');
    expect(argString).toContain('[cv0][cv1]concat=n=2:v=1:a=0[camera_concat]');
    expect(argString).toContain('[camera_concat]fps=30,setsar=1[camera_raw]');
  });

  test('renderComposite keeps reused input indexes stable across mixed take ordering', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'video-render-mixed-dedupe-'));
    const outputDir = path.join(tmpDir, 'out');
    const screenA = path.join(tmpDir, 'screen-a.webm');
    const cameraA = path.join(tmpDir, 'camera-a.webm');
    const screenB = path.join(tmpDir, 'screen-b.webm');
    const cameraB = path.join(tmpDir, 'camera-b.webm');
    fs.writeFileSync(screenA, 'screen-a', 'utf8');
    fs.writeFileSync(cameraA, 'camera-a', 'utf8');
    fs.writeFileSync(screenB, 'screen-b', 'utf8');
    fs.writeFileSync(cameraB, 'camera-b', 'utf8');

    const execCalls: { bin: string; args: string[] }[] = [];
    await renderComposite(
      {
        outputFolder: outputDir,
        takes: [
          { id: 'take-a', screenPath: screenA, cameraPath: cameraA },
          { id: 'take-b', screenPath: screenB, cameraPath: cameraB }
        ],
        sections: [
          { takeId: 'take-a', sourceStart: 0, sourceEnd: 1.0 },
          { takeId: 'take-b', sourceStart: 1.0, sourceEnd: 2.0 },
          { takeId: 'take-a', sourceStart: 2.0, sourceEnd: 3.0 }
        ],
        keyframes: [
          { time: 0, pipX: 10, pipY: 10, pipVisible: true, cameraFullscreen: false }
        ] as Keyframe[],
        pipSize: 300,
        sourceWidth: 1920,
        sourceHeight: 1080,
        screenFitMode: 'fill'
      },
      {
        ffmpegPath: '/usr/bin/ffmpeg',
        now: () => 333,
        probeVideoFpsWithFfmpeg: async () => 30,
        runFfmpeg: createRunFfmpegStub(({ ffmpegPath, args }) => {
          execCalls.push({ bin: ffmpegPath, args });
        })
      }
    );

    const argString = execCalls[0].args.join(' ');
    expect(execCalls[0].args.filter((value) => value === '-i')).toHaveLength(4);
    expect(argString).toContain(
      '[0:v]trim=start=0.000:end=1.000,setpts=PTS-STARTPTS,tpad=start_mode=clone:start_duration=0.000:stop_mode=clone:stop_duration=0.250,trim=duration=1.000,setpts=PTS-STARTPTS,setsar=1[sv0]'
    );
    expect(argString).toContain(
      '[2:v]trim=start=1.000:end=2.000,setpts=PTS-STARTPTS,tpad=start_mode=clone:start_duration=0.000:stop_mode=clone:stop_duration=0.250,trim=duration=1.000,setpts=PTS-STARTPTS,setsar=1[sv1]'
    );
    expect(argString).toContain(
      '[0:v]trim=start=2.000:end=3.000,setpts=PTS-STARTPTS,tpad=start_mode=clone:start_duration=0.000:stop_mode=clone:stop_duration=0.250,trim=duration=1.000,setpts=PTS-STARTPTS,setsar=1[sv2]'
    );
    expect(argString).toContain(
      '[1:v]trim=start=0.000:end=1.000,setpts=PTS-STARTPTS,tpad=start_mode=clone:start_duration=0.000:stop_mode=clone:stop_duration=0.250,trim=duration=1.000,setpts=PTS-STARTPTS[cv0]'
    );
    expect(argString).toContain(
      '[3:v]trim=start=1.000:end=2.000,setpts=PTS-STARTPTS,tpad=start_mode=clone:start_duration=0.000:stop_mode=clone:stop_duration=0.250,trim=duration=1.000,setpts=PTS-STARTPTS[cv1]'
    );
    expect(argString).toContain(
      '[1:v]trim=start=2.000:end=3.000,setpts=PTS-STARTPTS,tpad=start_mode=clone:start_duration=0.000:stop_mode=clone:stop_duration=0.250,trim=duration=1.000,setpts=PTS-STARTPTS[cv2]'
    );
  });

  test('renderComposite normalizes VFR to CFR once after concat, not per-section', async () => {
    // Per the AGENTS.md learned fact: per-section `fps=N,trim=duration=D`
    // drifts trimmed durations by a few frames over multi-section exports
    // because each section's trim is rounded independently. Applying the
    // fps filter a single time after concat keeps the exported durations
    // aligned with the per-section trim windows.
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'video-render-fps-post-concat-'));
    const outputDir = path.join(tmpDir, 'out');
    const screenPath = path.join(tmpDir, 'screen.webm');
    fs.writeFileSync(screenPath, 'screen', 'utf8');

    const execCalls: { bin: string; args: string[] }[] = [];
    await renderComposite(
      {
        outputFolder: outputDir,
        takes: [{ id: 'take-1', screenPath, cameraPath: null }],
        sections: [
          { takeId: 'take-1', sourceStart: 0, sourceEnd: 61.113 },
          { takeId: 'take-1', sourceStart: 90.017, sourceEnd: 143.531 },
          { takeId: 'take-1', sourceStart: 200.201, sourceEnd: 271.889 }
        ],
        keyframes: [
          { time: 0, pipX: 10, pipY: 10, pipVisible: false, cameraFullscreen: false }
        ] as Keyframe[],
        pipSize: 300,
        sourceWidth: 1920,
        sourceHeight: 1080,
        screenFitMode: 'fill'
      },
      {
        ffmpegPath: '/usr/bin/ffmpeg',
        now: () => 334,
        probeVideoFpsWithFfmpeg: async () => 29.97,
        runFfmpeg: createRunFfmpegStub(({ ffmpegPath, args }) => {
          execCalls.push({ bin: ffmpegPath, args });
        })
      }
    );

    const argString = execCalls[0].args.join(' ');
    // Per-section trims must NOT apply fps per section (that caused multi-
    // section exports to drift a frame or two per section), but each section
    // MUST still lock its output duration via tpad + trim=duration so
    // VFR source quirks do not quietly shorten any section's video.
    expect(argString).toContain(
      '[0:v]trim=start=0.000:end=61.113,setpts=PTS-STARTPTS,tpad=start_mode=clone:start_duration=0.000:stop_mode=clone:stop_duration=0.250,trim=duration=61.113,setpts=PTS-STARTPTS,setsar=1[sv0]'
    );
    expect(argString).toContain(
      '[0:v]trim=start=90.017:end=143.531,setpts=PTS-STARTPTS,tpad=start_mode=clone:start_duration=0.000:stop_mode=clone:stop_duration=0.250,trim=duration=53.514,setpts=PTS-STARTPTS,setsar=1[sv1]'
    );
    expect(argString).toContain(
      '[0:v]trim=start=200.201:end=271.889,setpts=PTS-STARTPTS,tpad=start_mode=clone:start_duration=0.000:stop_mode=clone:stop_duration=0.250,trim=duration=71.688,setpts=PTS-STARTPTS,setsar=1[sv2]'
    );
    // And the single fps normalization step runs after the concat once.
    expect(argString).toContain('[screen_concat]fps=30,setsar=1[screen_raw]');
    // Exactly one post-concat fps filter per branch: screen only here
    // (single-branch export), so 'fps=30' appears exactly once in the
    // filter graph when the overlay/zoompan path is not active.
    const fps30Matches = (argString.match(/fps=30/g) || []).length;
    expect(fps30Matches).toBe(1);
    expect(execCalls[0].args).not.toContain('-r');
  });

  test('renderComposite forwards mapped progress updates from ffmpeg output time', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'video-render-progress-'));
    const outputDir = path.join(tmpDir, 'out');
    const screenPath = path.join(tmpDir, 'screen.webm');
    fs.writeFileSync(screenPath, 'screen', 'utf8');

    const updates: unknown[] = [];
    await renderComposite(
      {
        outputFolder: outputDir,
        takes: [{ id: 'take-1', screenPath, cameraPath: null }],
        sections: [{ takeId: 'take-1', sourceStart: 0, sourceEnd: 4.0 }],
        keyframes: [
          { time: 0, pipX: 10, pipY: 10, pipVisible: false, cameraFullscreen: false }
        ] as Keyframe[],
        pipSize: 300,
        sourceWidth: 1920,
        sourceHeight: 1080,
        screenFitMode: 'fill'
      },
      {
        ffmpegPath: '/usr/bin/ffmpeg',
        now: () => 444,
        probeVideoFpsWithFfmpeg: async () => 30,
        onProgress: (update) => updates.push(update),
        runFfmpeg: createRunFfmpegStub(({ onProgress }) => {
          onProgress!({
            status: 'continue',
            outTimeSec: 2,
            frame: 48,
            speed: 1.1,
            fps: null,
            raw: {}
          });
          onProgress!({ status: 'end', outTimeSec: 4, frame: 96, speed: 0.9, fps: null, raw: {} });
        })
      }
    );

    expect(updates[0]).toEqual(
      expect.objectContaining({
        phase: 'starting',
        percent: 0,
        status: 'Preparing render...'
      })
    );
    expect(updates[1]).toEqual(
      expect.objectContaining({
        phase: 'rendering',
        percent: 0.5,
        status: 'Rendering 50%',
        frame: 48,
        speed: 1.1
      })
    );
    expect(updates[2]).toEqual(
      expect.objectContaining({
        phase: 'finalizing',
        percent: 1,
        status: 'Finalizing export...'
      })
    );
  });

  test('renderComposite pulls audio from the camera input when audioSource is camera', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'video-render-audio-camera-'));
    const outputDir = path.join(tmpDir, 'out');
    const screenPath = path.join(tmpDir, 'screen.webm');
    const cameraPath = path.join(tmpDir, 'camera.webm');
    fs.writeFileSync(screenPath, 'screen', 'utf8');
    fs.writeFileSync(cameraPath, 'camera', 'utf8');

    const execCalls: { bin: string; args: string[] }[] = [];
    await renderComposite(
      {
        outputFolder: outputDir,
        takes: [
          {
            id: 'take-1',
            screenPath,
            cameraPath,
            audioPath: null,
            audioSource: 'camera'
          }
        ],
        sections: [{ takeId: 'take-1', sourceStart: 0, sourceEnd: 1.5 }],
        keyframes: [
          { time: 0, pipX: 10, pipY: 10, pipVisible: true, cameraFullscreen: false }
        ] as Keyframe[],
        pipSize: 300,
        sourceWidth: 1920,
        sourceHeight: 1080,
        screenFitMode: 'fill'
      },
      {
        ffmpegPath: '/usr/bin/ffmpeg',
        now: () => 998,
        probeVideoFpsWithFfmpeg: async () => 30,
        runFfmpeg: createRunFfmpegStub(({ ffmpegPath, args }) => {
          execCalls.push({ bin: ffmpegPath, args });
        })
      }
    );

    const argString = execCalls[0].args.join(' ');
    // Audio must now be trimmed from the camera input (index 1), not the
    // screen input (index 0) for takes whose mic is muxed into the camera.
    expect(argString).toContain('[1:a]atrim=start=0.000:end=1.500');
    expect(argString).not.toContain('[0:a]atrim=start=0.000:end=1.500');
  });

  test('renderComposite adds a dedicated audio input when audioSource is external', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'video-render-audio-external-'));
    const outputDir = path.join(tmpDir, 'out');
    const screenPath = path.join(tmpDir, 'screen.webm');
    const audioPath = path.join(tmpDir, 'audio.webm');
    fs.writeFileSync(screenPath, 'screen', 'utf8');
    fs.writeFileSync(audioPath, 'audio', 'utf8');

    const execCalls: { bin: string; args: string[] }[] = [];
    await renderComposite(
      {
        outputFolder: outputDir,
        takes: [
          {
            id: 'take-1',
            screenPath,
            cameraPath: null,
            audioPath,
            audioSource: 'external'
          }
        ],
        sections: [{ takeId: 'take-1', sourceStart: 0, sourceEnd: 1.0 }],
        keyframes: [
          { time: 0, pipX: 10, pipY: 10, pipVisible: false, cameraFullscreen: false }
        ] as Keyframe[],
        pipSize: 300,
        sourceWidth: 1920,
        sourceHeight: 1080,
        screenFitMode: 'fill'
      },
      {
        ffmpegPath: '/usr/bin/ffmpeg',
        now: () => 997,
        probeVideoFpsWithFfmpeg: async () => 30,
        runFfmpeg: createRunFfmpegStub(({ ffmpegPath, args }) => {
          execCalls.push({ bin: ffmpegPath, args });
        })
      }
    );

    const args = execCalls[0].args;
    // Both the screen and the dedicated mic file must be registered as ffmpeg
    // inputs; audio trim must target the second input.
    expect(args.filter((value) => value === '-i')).toHaveLength(2);
    expect(args).toEqual(expect.arrayContaining([screenPath, audioPath]));
    const argString = args.join(' ');
    expect(argString).toContain('[1:a]atrim=start=0.000:end=1.000');
    expect(argString).not.toContain('[0:a]atrim=start=0.000:end=1.000');
  });

  test('renderComposite keeps legacy takes (audioSource omitted) reading screen audio', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'video-render-audio-legacy-'));
    const outputDir = path.join(tmpDir, 'out');
    const screenPath = path.join(tmpDir, 'screen.webm');
    fs.writeFileSync(screenPath, 'screen', 'utf8');

    const execCalls: { bin: string; args: string[] }[] = [];
    await renderComposite(
      {
        outputFolder: outputDir,
        // Intentionally omit audioPath / audioSource to simulate a take saved
        // before the routing change was introduced.
        takes: [{ id: 'take-1', screenPath, cameraPath: null }],
        sections: [{ takeId: 'take-1', sourceStart: 0, sourceEnd: 1.0 }],
        keyframes: [
          { time: 0, pipX: 10, pipY: 10, pipVisible: false, cameraFullscreen: false }
        ] as Keyframe[],
        pipSize: 300,
        sourceWidth: 1920,
        sourceHeight: 1080,
        screenFitMode: 'fill'
      },
      {
        ffmpegPath: '/usr/bin/ffmpeg',
        now: () => 996,
        probeVideoFpsWithFfmpeg: async () => 30,
        runFfmpeg: createRunFfmpegStub(({ ffmpegPath, args }) => {
          execCalls.push({ bin: ffmpegPath, args });
        })
      }
    );

    const argString = execCalls[0].args.join(' ');
    expect(argString).toContain('[0:a]atrim=start=0.000:end=1.000');
  });

  test('renderComposite keeps camera input for audio even when PiP is not visible', async () => {
    const tmpDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'video-render-audio-camera-hidden-')
    );
    const outputDir = path.join(tmpDir, 'out');
    const screenPath = path.join(tmpDir, 'screen.webm');
    const cameraPath = path.join(tmpDir, 'camera.webm');
    fs.writeFileSync(screenPath, 'screen', 'utf8');
    fs.writeFileSync(cameraPath, 'camera', 'utf8');

    const execCalls: { bin: string; args: string[] }[] = [];
    await renderComposite(
      {
        outputFolder: outputDir,
        takes: [
          {
            id: 'take-1',
            screenPath,
            cameraPath,
            audioPath: null,
            audioSource: 'camera'
          }
        ],
        sections: [{ takeId: 'take-1', sourceStart: 0, sourceEnd: 1.0 }],
        // No keyframe shows the PiP — camera video is not rendered, but its
        // audio must still be wired in because that's where the mic lives.
        keyframes: [
          { time: 0, pipX: 10, pipY: 10, pipVisible: false, cameraFullscreen: false }
        ] as Keyframe[],
        pipSize: 300,
        sourceWidth: 1920,
        sourceHeight: 1080,
        screenFitMode: 'fill'
      },
      {
        ffmpegPath: '/usr/bin/ffmpeg',
        now: () => 995,
        probeVideoFpsWithFfmpeg: async () => 30,
        runFfmpeg: createRunFfmpegStub(({ ffmpegPath, args }) => {
          execCalls.push({ bin: ffmpegPath, args });
        })
      }
    );

    const args = execCalls[0].args;
    expect(args.filter((value) => value === '-i')).toHaveLength(2);
    expect(args).toEqual(expect.arrayContaining([screenPath, cameraPath]));
    const argString = args.join(' ');
    expect(argString).toContain('[1:a]atrim=start=0.000:end=1.000');
  });

  test('renderComposite mixes mic and system audio via amix when both exist', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'video-render-amix-'));
    const outputDir = path.join(tmpDir, 'out');
    const screenPath = path.join(tmpDir, 'screen.webm');
    const cameraPath = path.join(tmpDir, 'camera.webm');
    fs.writeFileSync(screenPath, 'screen', 'utf8');
    fs.writeFileSync(cameraPath, 'camera', 'utf8');

    const execCalls: { bin: string; args: string[] }[] = [];
    await renderComposite(
      {
        outputFolder: outputDir,
        takes: [
          {
            id: 'take-1',
            screenPath,
            cameraPath,
            audioPath: null,
            audioSource: 'camera',
            hasSystemAudio: true
          }
        ],
        sections: [{ takeId: 'take-1', sourceStart: 0, sourceEnd: 1.0 }],
        keyframes: [
          { time: 0, pipX: 10, pipY: 10, pipVisible: true, cameraFullscreen: false }
        ] as Keyframe[],
        pipSize: 300,
        sourceWidth: 1920,
        sourceHeight: 1080,
        screenFitMode: 'fill'
      },
      {
        ffmpegPath: '/usr/bin/ffmpeg',
        now: () => 700,
        probeVideoFpsWithFfmpeg: async () => 30,
        runFfmpeg: createRunFfmpegStub(({ ffmpegPath, args }) => {
          execCalls.push({ bin: ffmpegPath, args });
        })
      }
    );

    const argString = execCalls[0].args.join(' ');
    // Both audio sources must be trimmed separately then mixed.
    expect(argString).toContain('[1:a]atrim=start=0.000:end=1.000');
    expect(argString).toContain('[0:a]atrim=start=0.000:end=1.000');
    expect(argString).toContain('amix=inputs=2:duration=longest:dropout_transition=0[sa0]');
  });

  test('renderComposite skips amix when hasSystemAudio is true but the mic is already muxed into screen', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'video-render-legacy-sys-'));
    const outputDir = path.join(tmpDir, 'out');
    const screenPath = path.join(tmpDir, 'screen.webm');
    fs.writeFileSync(screenPath, 'screen', 'utf8');

    const execCalls: { bin: string; args: string[] }[] = [];
    await renderComposite(
      {
        outputFolder: outputDir,
        // Legacy shape: mic is on screen file AND hasSystemAudio is true.
        // Mixing would duplicate the single on-disk audio track, so the
        // filter graph should fall back to a single-source trim.
        takes: [
          {
            id: 'take-1',
            screenPath,
            cameraPath: null,
            audioSource: 'screen',
            hasSystemAudio: true
          }
        ],
        sections: [{ takeId: 'take-1', sourceStart: 0, sourceEnd: 1.0 }],
        keyframes: [
          { time: 0, pipX: 10, pipY: 10, pipVisible: false, cameraFullscreen: false }
        ] as Keyframe[],
        pipSize: 300,
        sourceWidth: 1920,
        sourceHeight: 1080,
        screenFitMode: 'fill'
      },
      {
        ffmpegPath: '/usr/bin/ffmpeg',
        now: () => 701,
        probeVideoFpsWithFfmpeg: async () => 30,
        runFfmpeg: createRunFfmpegStub(({ ffmpegPath, args }) => {
          execCalls.push({ bin: ffmpegPath, args });
        })
      }
    );

    const argString = execCalls[0].args.join(' ');
    expect(argString).not.toContain('amix');
    expect(argString).toContain('[0:a]atrim=start=0.000:end=1.000');
  });

  test('computeShiftedTrimWindow preserves section duration via start/stop padding', () => {
    // No shift: window unchanged, no padding required.
    expect(computeShiftedTrimWindow(0, 1.0, 0)).toMatchObject({
      sampleStart: 0,
      startPad: 0,
      stopPad: 0,
      duration: 1.0
    });

    // Negative shift (sample earlier): the effective start lands below 0, so
    // the trim is clamped to 0 and the prefix gap is filled by clone/silence
    // padding so the downstream trim=duration still hits the section length.
    const earlier = computeShiftedTrimWindow(0, 1.0, -0.2);
    expect(earlier.sampleStart).toBe(0);
    expect(earlier.startPad).toBeCloseTo(0.2, 6);
    expect(earlier.stopPad).toBe(0);
    expect(earlier.duration).toBeCloseTo(1.0, 6);

    // Positive shift (sample later): window pushes past the section end, so
    // we get stop padding to keep the output duration correct even if the
    // source clip is a bit short.
    const later = computeShiftedTrimWindow(0, 1.0, 0.12);
    expect(later.sampleStart).toBeCloseTo(0.12, 6);
    expect(later.sampleEnd).toBeCloseTo(1.12, 6);
    expect(later.startPad).toBe(0);
    expect(later.stopPad).toBeCloseTo(0.12, 6);

    // Interior-section negative shift: sampleStart > 0, no padding needed.
    const interior = computeShiftedTrimWindow(5.0, 6.0, -0.05);
    expect(interior.sampleStart).toBeCloseTo(4.95, 6);
    expect(interior.sampleEnd).toBeCloseTo(5.95, 6);
    expect(interior.startPad).toBe(0);
    expect(interior.stopPad).toBe(0);
  });

  test('renderComposite shifts screen trim by measured screenStartOffsetMs', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'video-render-screen-offset-'));
    const outputDir = path.join(tmpDir, 'out');
    const screenPath = path.join(tmpDir, 'screen.webm');
    const cameraPath = path.join(tmpDir, 'camera.webm');
    fs.writeFileSync(screenPath, 'screen', 'utf8');
    fs.writeFileSync(cameraPath, 'camera', 'utf8');

    const execCalls: { bin: string; args: string[] }[] = [];
    await renderComposite(
      {
        outputFolder: outputDir,
        // Camera is the anchor; screen first-chunk arrived 150ms later. The
        // screen trim window must slide earlier by 150ms so the exported
        // section represents the same real-world moment as the camera trim.
        takes: [
          {
            id: 'take-1',
            screenPath,
            cameraPath,
            screenStartOffsetMs: 150,
            cameraStartOffsetMs: 0
          }
        ],
        sections: [{ takeId: 'take-1', sourceStart: 2.0, sourceEnd: 3.0 }],
        keyframes: [
          { time: 0, pipX: 10, pipY: 10, pipVisible: true, cameraFullscreen: false }
        ] as Keyframe[],
        pipSize: 300,
        sourceWidth: 1920,
        sourceHeight: 1080,
        screenFitMode: 'fill'
      },
      {
        ffmpegPath: '/usr/bin/ffmpeg',
        now: () => 111,
        probeVideoFpsWithFfmpeg: async () => 30,
        runFfmpeg: createRunFfmpegStub(({ ffmpegPath, args }) => {
          execCalls.push({ bin: ffmpegPath, args });
        })
      }
    );

    const argString = execCalls[0].args.join(' ');
    // Interior section: shifting start by -0.15 lands on 1.85/2.85 cleanly
    // (no shift-driven stop-pad needed), but the constant 0.250s safety pad
    // is always present so the per-section video duration is locked to the
    // nominal length even for VFR sources that otherwise lose a few frames.
    expect(argString).toContain(
      '[0:v]trim=start=1.850:end=2.850,setpts=PTS-STARTPTS,tpad=start_mode=clone:start_duration=0.000:stop_mode=clone:stop_duration=0.250,trim=duration=1.000,setpts=PTS-STARTPTS,setsar=1[sv0]'
    );
    // Camera has no auto/user offset for this take, but still gets the same
    // safety pad + trim=duration so audio/video stay locked in lockstep.
    expect(argString).toContain(
      '[1:v]trim=start=2.000:end=3.000,setpts=PTS-STARTPTS,tpad=start_mode=clone:start_duration=0.000:stop_mode=clone:stop_duration=0.250,trim=duration=1.000,setpts=PTS-STARTPTS[cv0]'
    );
    // Screen mic audio rides with the screen file, so it must be shifted by
    // the same -150ms. Audio always gets apad+atrim=duration so each
    // section's audio length matches its video exactly.
    expect(argString).toContain(
      '[0:a]atrim=start=1.850:end=2.850,asetpts=PTS-STARTPTS,apad=pad_dur=0.250,atrim=duration=1.000,asetpts=PTS-STARTPTS[sa0]'
    );
  });

  test('renderComposite shifts camera trim by auto offset and adds user offset on top', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'video-render-camera-auto-offset-'));
    const outputDir = path.join(tmpDir, 'out');
    const screenPath = path.join(tmpDir, 'screen.webm');
    const cameraPath = path.join(tmpDir, 'camera.webm');
    fs.writeFileSync(screenPath, 'screen', 'utf8');
    fs.writeFileSync(cameraPath, 'camera', 'utf8');

    const execCalls: { bin: string; args: string[] }[] = [];
    await renderComposite(
      {
        outputFolder: outputDir,
        // Screen is the anchor; camera first-chunk arrived 120ms later. A
        // user-dialed +30ms fine-tune is additive (sample even later than
        // the auto correction). Expected net camera shift = -0.12 + 0.03 =
        // -0.09, so the trim window slides 90ms earlier.
        takes: [
          {
            id: 'take-1',
            screenPath,
            cameraPath,
            screenStartOffsetMs: 0,
            cameraStartOffsetMs: 120
          }
        ],
        sections: [{ takeId: 'take-1', sourceStart: 2.0, sourceEnd: 3.0 }],
        keyframes: [
          { time: 0, pipX: 10, pipY: 10, pipVisible: true, cameraFullscreen: false }
        ] as Keyframe[],
        pipSize: 300,
        sourceWidth: 1920,
        sourceHeight: 1080,
        screenFitMode: 'fill',
        cameraSyncOffsetMs: 30
      },
      {
        ffmpegPath: '/usr/bin/ffmpeg',
        now: () => 222,
        probeVideoFpsWithFfmpeg: async () => 30,
        runFfmpeg: createRunFfmpegStub(({ ffmpegPath, args }) => {
          execCalls.push({ bin: ffmpegPath, args });
        })
      }
    );

    const argString = execCalls[0].args.join(' ');
    // Interior section (sectionStart >> 0) with net negative shift: no
    // start-pad (effectiveStart > 0), no shift-driven stop-pad (we're
    // pulling from a still-valid range), but the 0.250s safety pad is
    // always present for duration locking.
    expect(argString).toContain(
      '[1:v]trim=start=1.910:end=2.910,setpts=PTS-STARTPTS,tpad=start_mode=clone:start_duration=0.000:stop_mode=clone:stop_duration=0.250,trim=duration=1.000,setpts=PTS-STARTPTS[cv0]'
    );
  });

  test('renderComposite clone-pads camera prefix when shifted window is before t=0', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'video-render-camera-prefix-pad-'));
    const outputDir = path.join(tmpDir, 'out');
    const screenPath = path.join(tmpDir, 'screen.webm');
    const cameraPath = path.join(tmpDir, 'camera.webm');
    fs.writeFileSync(screenPath, 'screen', 'utf8');
    fs.writeFileSync(cameraPath, 'camera', 'utf8');

    const execCalls: { bin: string; args: string[] }[] = [];
    await renderComposite(
      {
        outputFolder: outputDir,
        takes: [
          {
            id: 'take-1',
            screenPath,
            cameraPath,
            screenStartOffsetMs: 0,
            cameraStartOffsetMs: 200
          }
        ],
        // Section at t=0 means the shifted camera window starts at -0.2s;
        // the trim is clamped to 0 and the missing 200ms is filled with
        // clone-padded frames so trim=duration still yields the full 1s.
        sections: [{ takeId: 'take-1', sourceStart: 0, sourceEnd: 1.0 }],
        keyframes: [
          { time: 0, pipX: 10, pipY: 10, pipVisible: true, cameraFullscreen: false }
        ] as Keyframe[],
        pipSize: 300,
        sourceWidth: 1920,
        sourceHeight: 1080,
        screenFitMode: 'fill'
      },
      {
        ffmpegPath: '/usr/bin/ffmpeg',
        now: () => 333,
        probeVideoFpsWithFfmpeg: async () => 30,
        runFfmpeg: createRunFfmpegStub(({ ffmpegPath, args }) => {
          execCalls.push({ bin: ffmpegPath, args });
        })
      }
    );

    const argString = execCalls[0].args.join(' ');
    // start_duration=0.200 fills the 200ms missing prefix with clone frames;
    // stop_duration=0.250 is the constant safety pad that locks every
    // section's output to its nominal length (so VFR sources can't shorten
    // it). trim=duration caps the final stream to exactly the section size.
    expect(argString).toContain(
      '[1:v]trim=start=0.000:end=0.800,setpts=PTS-STARTPTS,tpad=start_mode=clone:start_duration=0.200:stop_mode=clone:stop_duration=0.250,trim=duration=1.000,setpts=PTS-STARTPTS[cv0]'
    );
  });

  test('renderComposite shifts audio for external audio files and uses silence padding', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'video-render-audio-offset-'));
    const outputDir = path.join(tmpDir, 'out');
    const screenPath = path.join(tmpDir, 'screen.webm');
    const audioPath = path.join(tmpDir, 'audio.webm');
    fs.writeFileSync(screenPath, 'screen', 'utf8');
    fs.writeFileSync(audioPath, 'audio', 'utf8');

    const execCalls: { bin: string; args: string[] }[] = [];
    await renderComposite(
      {
        outputFolder: outputDir,
        // Screen is the anchor; the dedicated mic file started recording
        // 90ms late, so sections must trim the audio file 90ms earlier
        // (clamped to 0 with silence prefix) to stay aligned with the
        // screen video at the same timeline moment.
        takes: [
          {
            id: 'take-1',
            screenPath,
            cameraPath: null,
            audioPath,
            audioSource: 'external',
            screenStartOffsetMs: 0,
            audioStartOffsetMs: 90
          }
        ],
        sections: [{ takeId: 'take-1', sourceStart: 0, sourceEnd: 1.0 }],
        keyframes: [
          { time: 0, pipX: 10, pipY: 10, pipVisible: false, cameraFullscreen: false }
        ] as Keyframe[],
        pipSize: 300,
        sourceWidth: 1920,
        sourceHeight: 1080,
        screenFitMode: 'fill'
      },
      {
        ffmpegPath: '/usr/bin/ffmpeg',
        now: () => 444,
        probeVideoFpsWithFfmpeg: async () => 30,
        runFfmpeg: createRunFfmpegStub(({ ffmpegPath, args }) => {
          execCalls.push({ bin: ffmpegPath, args });
        })
      }
    );

    const argString = execCalls[0].args.join(' ');
    // adelay prepends 90ms of silence so the audio lines up with the video
    // section; apad then adds the 0.250s silence safety pad, and the final
    // atrim=duration caps to exactly 1.000s.
    expect(argString).toContain(
      '[1:a]atrim=start=0.000:end=0.910,asetpts=PTS-STARTPTS,adelay=90|90,apad=pad_dur=0.250,atrim=duration=1.000,asetpts=PTS-STARTPTS[sa0]'
    );
  });

  test('renderComposite multi-section + camera + offsets applies fps=N exactly once per concat branch', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'video-render-multi-offset-'));
    const outputDir = path.join(tmpDir, 'out');
    const screenPath = path.join(tmpDir, 'screen.webm');
    const cameraPath = path.join(tmpDir, 'camera.webm');
    fs.writeFileSync(screenPath, 'screen', 'utf8');
    fs.writeFileSync(cameraPath, 'camera', 'utf8');

    const execCalls: { bin: string; args: string[] }[] = [];
    await renderComposite(
      {
        outputFolder: outputDir,
        takes: [
          {
            id: 'take-1',
            screenPath,
            cameraPath,
            screenStartOffsetMs: 0,
            cameraStartOffsetMs: 120
          }
        ],
        sections: [
          { takeId: 'take-1', sourceStart: 2, sourceEnd: 6.04 },
          { takeId: 'take-1', sourceStart: 9, sourceEnd: 11.22 },
          { takeId: 'take-1', sourceStart: 15, sourceEnd: 18.04 }
        ],
        keyframes: [
          { time: 0, pipX: 10, pipY: 10, pipVisible: true, cameraFullscreen: false }
        ] as Keyframe[],
        pipSize: 300,
        sourceWidth: 1920,
        sourceHeight: 1080,
        screenFitMode: 'fill'
      },
      {
        ffmpegPath: '/usr/bin/ffmpeg',
        now: () => 555,
        probeVideoFpsWithFfmpeg: async () => 29.97,
        runFfmpeg: createRunFfmpegStub(({ ffmpegPath, args }) => {
          execCalls.push({ bin: ffmpegPath, args });
        })
      }
    );

    const argString = execCalls[0].args.join(' ');
    // Both concat branches get fps normalized once, AFTER the concat, not
    // once per section — that is the whole point of the AGENTS.md rule.
    expect(argString).toContain('concat=n=3:v=1:a=1[screen_concat][audio_out]');
    expect(argString).toContain('[screen_concat]fps=30,setsar=1[screen_raw]');
    expect(argString).toContain('[cv0][cv1][cv2]concat=n=3:v=1:a=0[camera_concat]');
    expect(argString).toContain('[camera_concat]fps=30,setsar=1[camera_raw]');
    // Exactly one fps step per branch — screen + camera + the zoompan path
    // would add more only if background animation is enabled (not here).
    const fps30Matches = (argString.match(/fps=30/g) || []).length;
    expect(fps30Matches).toBe(2);
    // Each section's camera trim window is shifted 120ms earlier; interior
    // sections (start >= 2s) need no start-pad and no shift-driven
    // stop-pad, but every section still gets the constant 0.250s safety
    // pad so `trim=duration=D` always hits D exactly even on VFR sources.
    expect(argString).toContain(
      '[1:v]trim=start=1.880:end=5.920,setpts=PTS-STARTPTS,tpad=start_mode=clone:start_duration=0.000:stop_mode=clone:stop_duration=0.250,trim=duration=4.040,setpts=PTS-STARTPTS[cv0]'
    );
    expect(argString).toContain(
      '[1:v]trim=start=8.880:end=11.100,setpts=PTS-STARTPTS,tpad=start_mode=clone:start_duration=0.000:stop_mode=clone:stop_duration=0.250,trim=duration=2.220,setpts=PTS-STARTPTS[cv1]'
    );
    expect(argString).toContain(
      '[1:v]trim=start=14.880:end=17.920,setpts=PTS-STARTPTS,tpad=start_mode=clone:start_duration=0.000:stop_mode=clone:stop_duration=0.250,trim=duration=3.040,setpts=PTS-STARTPTS[cv2]'
    );
  });

  test('every section trim locks its output duration via tpad+trim=duration so VFR sources cannot drift audio against video', async () => {
    // Regression guard. The original export pipeline wrapped each
    // per-section `trim` with `fps=N,trim=duration=D` so any frame lost to
    // VFR quantization on `trim=X:Y` was replaced by a duplicate/adjacent
    // frame, keeping video section length exactly equal to audio section
    // length. Phase 1c moved `fps=N` to a single post-concat filter, but
    // it dropped the per-section `trim=duration=D` in the process, which
    // let VFR sources quietly shorten per-section video by up to a frame.
    // Over a many-section export that produced a growing audio-ahead-of-
    // video offset — reported as "camera + audio drift" on long exports.
    //
    // This test pins the invariant: EVERY per-section video trim ends with
    // `tpad=...,trim=duration=D,setpts=PTS-STARTPTS` and EVERY per-section
    // audio trim ends with `apad=...,atrim=duration=D,asetpts=...` so both
    // contribute exactly D seconds of content to the concat regardless of
    // whether the source was VFR, short-tailed, or perfectly aligned.
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'video-render-section-duration-lock-'));
    const outputDir = path.join(tmpDir, 'out');
    const screenPath = path.join(tmpDir, 'screen.webm');
    const cameraPath = path.join(tmpDir, 'camera.webm');
    fs.writeFileSync(screenPath, 'screen', 'utf8');
    fs.writeFileSync(cameraPath, 'camera', 'utf8');

    const sections = [
      { takeId: 'take-1', sourceStart: 0, sourceEnd: 4.017 },
      { takeId: 'take-1', sourceStart: 9.0, sourceEnd: 17.213 },
      { takeId: 'take-1', sourceStart: 18.1, sourceEnd: 21.124 },
      { takeId: 'take-1', sourceStart: 21.8, sourceEnd: 25.834 },
      { takeId: 'take-1', sourceStart: 31.9, sourceEnd: 33.6 }
    ];

    const execCalls: { bin: string; args: string[] }[] = [];
    await renderComposite(
      {
        outputFolder: outputDir,
        takes: [{ id: 'take-1', screenPath, cameraPath }],
        sections,
        keyframes: [
          { time: 0, pipX: 10, pipY: 10, pipVisible: true, cameraFullscreen: false }
        ] as Keyframe[],
        pipSize: 300,
        sourceWidth: 1920,
        sourceHeight: 1080,
        screenFitMode: 'fill'
      },
      {
        ffmpegPath: '/usr/bin/ffmpeg',
        now: () => 906,
        // Simulate the VFR screen source seen in the field (~29.25 effective
        // fps) so a regression that reintroduces the drift shows up clearly.
        probeVideoFpsWithFfmpeg: async () => 29.25,
        runFfmpeg: createRunFfmpegStub(({ ffmpegPath, args }) => {
          execCalls.push({ bin: ffmpegPath, args });
        })
      }
    );

    const argString = execCalls[0].args.join(' ');
    for (let index = 0; index < sections.length; index += 1) {
      const duration = (sections[index].sourceEnd - sections[index].sourceStart).toFixed(3);
      // Screen video must end with `trim=duration=D,setpts=PTS-STARTPTS`.
      expect(argString).toMatch(
        new RegExp(
          `\\[0:v\\][^;]*?trim=duration=${duration}[^,]*,setpts=PTS-STARTPTS[^;]*?\\[sv${index}\\]`
        )
      );
      // Camera video must end the same way.
      expect(argString).toMatch(
        new RegExp(
          `\\[1:v\\][^;]*?trim=duration=${duration}[^,]*,setpts=PTS-STARTPTS\\[cv${index}\\]`
        )
      );
      // Audio must end with `atrim=duration=D,asetpts=...` so it contributes
      // exactly D seconds to the audio concat — matching the video length.
      expect(argString).toMatch(
        new RegExp(
          `\\[0:a\\][^;]*?atrim=duration=${duration}[^,]*,asetpts=PTS-STARTPTS\\[sa${index}\\]`
        )
      );
    }
  });

  test('renderComposite keeps overlay filters bounded for long redundant camera timelines', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'video-render-long-keyframes-'));
    const outputDir = path.join(tmpDir, 'out');
    const screenPath = path.join(tmpDir, 'screen.webm');
    const cameraPath = path.join(tmpDir, 'camera.webm');
    fs.writeFileSync(screenPath, 'screen', 'utf8');
    fs.writeFileSync(cameraPath, 'camera', 'utf8');

    const execCalls: { bin: string; args: string[] }[] = [];
    const keyframes = Array.from({ length: 240 }, (_, index) => ({
      time: index * 15,
      pipX: 10,
      pipY: 10,
      pipVisible: true,
      cameraFullscreen: false,
      backgroundZoom: 1,
      backgroundPanX: 0,
      backgroundPanY: 0
    })) as Keyframe[];

    await renderComposite(
      {
        outputFolder: outputDir,
        takes: [{ id: 'take-1', screenPath, cameraPath }],
        sections: [{ takeId: 'take-1', sourceStart: 0, sourceEnd: 3600 }],
        keyframes,
        pipSize: 300,
        sourceWidth: 1920,
        sourceHeight: 1080,
        screenFitMode: 'fill'
      },
      {
        ffmpegPath: '/usr/bin/ffmpeg',
        now: () => 555,
        probeVideoFpsWithFfmpeg: async () => 30,
        runFfmpeg: createRunFfmpegStub(({ ffmpegPath, args }) => {
          execCalls.push({ bin: ffmpegPath, args });
        })
      }
    );

    const argString = execCalls[0].args.join(' ');
    expect(argString).toContain("overlay=x='10':y='10'");
    expect(argString).not.toContain('if(gte(T,');
  });
});
