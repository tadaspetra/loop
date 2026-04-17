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
    // Concat now emits [screen_raw][audio_out] directly (each section was
    // already CFR-normalized via `fps=N` BEFORE `trim`, so no post-concat
    // fps filter is needed). The 'off' audio preset maps audio_out
    // directly to the output with no compressor in the chain.
    expect(argString).toContain('[screen_raw][audio_out]');
    expect(argString).toContain('-map [audio_out]');
    expect(argString).not.toContain('acompressor=');
    expect(argString).not.toContain('[audio_final]');
    // fps=N should be present per-section (before trim), never in a
    // separate post-concat chain that transforms [screen_raw].
    expect(argString).not.toContain('[screen_raw]fps=');
    expect(argString).not.toContain('screen_concat');
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
    // No shift for this take, so the camera trim is a plain trim+setpts
    // chain with `fps=N` INSERTED BEFORE the trim. Applying fps=N before
    // trim (rather than after concat) lets per-section durations stay
    // exactly matched to the sample-accurate audio even when the screen
    // source is VFR with multi-second static-screen gaps.
    expect(argString).toContain('[1:v]fps=30,trim=start=0.000:end=1.000,setpts=PTS-STARTPTS[cv0]');
    expect(argString).toContain('[cv0]concat=n=1:v=1:a=0[camera_raw]');
    // No post-concat fps filter on [camera_raw] — it's already CFR from
    // the per-section fps=N preamble.
    expect(argString).not.toContain('[camera_raw]fps=');
    expect(argString).not.toContain('camera_concat');
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
    // User camera sync offset shifts the sample window; tpad + trim=duration
    // is used to clone-pad past the source tail when the shifted window
    // would otherwise run out of content.
    expect(argString).toContain(
      '[1:v]fps=30,trim=start=0.120:end=1.120,setpts=PTS-STARTPTS,tpad=start_mode=clone:start_duration=0.000:stop_mode=clone:stop_duration=0.120,trim=duration=1.000,setpts=PTS-STARTPTS[cv0]'
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
    // Unshifted sections use a plain `trim=X:Y,setpts=PTS-STARTPTS` chain.
    // The trim filter reports duration = (Y - X) to downstream concat and
    // fps filters, which then line up with the sample-accurate atrim on
    // the audio side. A single post-concat `fps=N` normalizes both video
    // branches to CFR so the exported durations match.
    expect(argString).toContain(
      '[0:v]fps=30,trim=start=0.000:end=1.000,setpts=PTS-STARTPTS,setsar=1[sv0]'
    );
    expect(argString).toContain(
      '[0:v]fps=30,trim=start=1.000:end=2.000,setpts=PTS-STARTPTS,setsar=1[sv1]'
    );
    expect(argString).toContain('[1:v]fps=30,trim=start=0.000:end=1.000,setpts=PTS-STARTPTS[cv0]');
    expect(argString).toContain('[1:v]fps=30,trim=start=1.000:end=2.000,setpts=PTS-STARTPTS[cv1]');
    expect(argString).toContain('concat=n=2:v=1:a=1[screen_raw][audio_out]');
    expect(argString).toContain('[cv0][cv1]concat=n=2:v=1:a=0[camera_raw]');
    // No post-concat fps step — each section is already CFR from the
    // per-section preamble, so concat directly yields [screen_raw] /
    // [camera_raw].
    expect(argString).not.toContain('screen_concat');
    expect(argString).not.toContain('camera_concat');
    expect(argString).not.toContain('[screen_raw]fps=');
    expect(argString).not.toContain('[camera_raw]fps=');
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
      '[0:v]fps=30,trim=start=0.000:end=1.000,setpts=PTS-STARTPTS,setsar=1[sv0]'
    );
    expect(argString).toContain(
      '[2:v]fps=30,trim=start=1.000:end=2.000,setpts=PTS-STARTPTS,setsar=1[sv1]'
    );
    expect(argString).toContain(
      '[0:v]fps=30,trim=start=2.000:end=3.000,setpts=PTS-STARTPTS,setsar=1[sv2]'
    );
    expect(argString).toContain('[1:v]fps=30,trim=start=0.000:end=1.000,setpts=PTS-STARTPTS[cv0]');
    expect(argString).toContain('[3:v]fps=30,trim=start=1.000:end=2.000,setpts=PTS-STARTPTS[cv1]');
    expect(argString).toContain('[1:v]fps=30,trim=start=2.000:end=3.000,setpts=PTS-STARTPTS[cv2]');
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
    // Per-section trims stay as plain `trim=X:Y,setpts=PTS-STARTPTS,setsar=1`
    // (no fps=N, no tpad, no trim=duration). The `trim` filter reports each
    // section's declared duration (Y - X) to the concat filter, and a
    // single post-concat `fps=N` normalizes the whole stream to CFR once.
    // This keeps per-section video and audio durations byte-exactly
    // equal to their nominal lengths.
    expect(argString).toContain(
      '[0:v]fps=30,trim=start=0.000:end=61.113,setpts=PTS-STARTPTS,setsar=1[sv0]'
    );
    expect(argString).toContain(
      '[0:v]fps=30,trim=start=90.017:end=143.531,setpts=PTS-STARTPTS,setsar=1[sv1]'
    );
    expect(argString).toContain(
      '[0:v]fps=30,trim=start=200.201:end=271.889,setpts=PTS-STARTPTS,setsar=1[sv2]'
    );
    // Each section emits its own `fps=N` BEFORE trim. There is no
    // post-concat fps filter and no `screen_concat` intermediate label
    // because concat feeds [screen_raw] directly.
    expect(argString).toContain('concat=n=3:v=1:a=1[screen_raw][audio_out]');
    expect(argString).not.toContain('screen_concat');
    expect(argString).not.toContain('[screen_raw]fps=');
    // Exactly one fps=N per section (3 screen sections, no camera in this
    // test — so 3 total).
    const fps30Matches = (argString.match(/fps=30/g) || []).length;
    expect(fps30Matches).toBe(3);
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
    // Shifted interior section: clean tpad + trim=duration chain so the
    // shifted window can't fall off the source's t=0. No safety stop pad
    // is added — adding one would over-extend the video vs its matching
    // audio section and drift the export.
    expect(argString).toContain(
      '[0:v]fps=30,trim=start=1.850:end=2.850,setpts=PTS-STARTPTS,tpad=start_mode=clone:start_duration=0.000:stop_mode=clone:stop_duration=0.000,trim=duration=1.000,setpts=PTS-STARTPTS,setsar=1[sv0]'
    );
    // Camera has no auto/user offset for this take, so its trim collapses
    // to the plain `trim + setpts` chain that lines up byte-for-byte with
    // the sample-accurate atrim on the audio side.
    expect(argString).toContain('[1:v]fps=30,trim=start=2.000:end=3.000,setpts=PTS-STARTPTS[cv0]');
    // Screen mic audio rides with the screen file, so it must be shifted
    // by the same -150ms. Audio gets adelay only when the window crosses
    // t=0 (not the case here); plain-looking atrim with the shift embedded
    // in start/end keeps the audio aligned to the shifted video.
    expect(argString).toContain(
      '[0:a]atrim=start=1.850:end=2.850,asetpts=PTS-STARTPTS,atrim=duration=1.000,asetpts=PTS-STARTPTS[sa0]'
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
    // start-pad (effectiveStart > 0) and no stop-pad (the shifted window
    // stays inside the source). Output duration = nominal 1.000s.
    expect(argString).toContain(
      '[1:v]fps=30,trim=start=1.910:end=2.910,setpts=PTS-STARTPTS,tpad=start_mode=clone:start_duration=0.000:stop_mode=clone:stop_duration=0.000,trim=duration=1.000,setpts=PTS-STARTPTS[cv0]'
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
    // start_duration=0.200 fills the 200ms missing prefix with clone frames
    // so the section's video window lines up with the section start. No
    // stop pad is needed because the shifted window still fits in the
    // source's tail.
    expect(argString).toContain(
      '[1:v]fps=30,trim=start=0.000:end=0.800,setpts=PTS-STARTPTS,tpad=start_mode=clone:start_duration=0.200:stop_mode=clone:stop_duration=0.000,trim=duration=1.000,setpts=PTS-STARTPTS[cv0]'
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
    // section, and the final atrim=duration clamps to exactly 1.000s.
    // No apad stop pad here because the shifted window fits in the source.
    expect(argString).toContain(
      '[1:a]atrim=start=0.000:end=0.910,asetpts=PTS-STARTPTS,adelay=90|90,atrim=duration=1.000,asetpts=PTS-STARTPTS[sa0]'
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
    // Both concat branches feed [screen_raw] / [camera_raw] directly —
    // no post-concat fps step, because each section applied `fps=N`
    // BEFORE its trim. That ordering is what keeps long VFR-with-gaps
    // exports from drifting audio against video (applying fps AFTER
    // setpts=PTS-STARTPTS on such sources stretches the per-section
    // duration beyond the declared trim length).
    expect(argString).toContain('concat=n=3:v=1:a=1[screen_raw][audio_out]');
    expect(argString).toContain('[cv0][cv1][cv2]concat=n=3:v=1:a=0[camera_raw]');
    expect(argString).not.toContain('screen_concat');
    expect(argString).not.toContain('camera_concat');
    expect(argString).not.toContain('[screen_raw]fps=');
    expect(argString).not.toContain('[camera_raw]fps=');
    // One fps=N per section per branch: 3 sections × 2 branches (screen +
    // camera) = 6 total. No post-concat fps, so exactly 6.
    const fps30Matches = (argString.match(/fps=30/g) || []).length;
    expect(fps30Matches).toBe(6);
    // Each section's camera trim window is shifted 120ms earlier; interior
    // sections (start >= 2s) need no start-pad and no shift-driven stop-pad
    // because the shifted window stays inside the source.
    expect(argString).toContain(
      '[1:v]fps=30,trim=start=1.880:end=5.920,setpts=PTS-STARTPTS,tpad=start_mode=clone:start_duration=0.000:stop_mode=clone:stop_duration=0.000,trim=duration=4.040,setpts=PTS-STARTPTS[cv0]'
    );
    expect(argString).toContain(
      '[1:v]fps=30,trim=start=8.880:end=11.100,setpts=PTS-STARTPTS,tpad=start_mode=clone:start_duration=0.000:stop_mode=clone:stop_duration=0.000,trim=duration=2.220,setpts=PTS-STARTPTS[cv1]'
    );
    expect(argString).toContain(
      '[1:v]fps=30,trim=start=14.880:end=17.920,setpts=PTS-STARTPTS,tpad=start_mode=clone:start_duration=0.000:stop_mode=clone:stop_duration=0.000,trim=duration=3.040,setpts=PTS-STARTPTS[cv2]'
    );
  });

  test('fps=N is applied BEFORE per-section trim (regression for VFR-gap post-setpts drift)', async () => {
    // Regression guard for a class of bugs that drift audio against video
    // on long multi-section exports of VFR screen captures:
    //
    // 1. `tpad + trim=duration=D` per section rounded video UP to the
    //    next 30fps grid boundary while atrim stayed sample-accurate,
    //    drifting a few ms per section.
    // 2. Running `fps=N` AFTER `setpts=PTS-STARTPTS` on a source with
    //    multi-second VFR gaps (getDisplayMedia only emits frames on
    //    screen change) made each section's fps-filtered video up to
    //    780ms longer than its nominal duration, drifting far more
    //    dramatically.
    //
    // The fix, pinned by this test: `fps=N` MUST run BEFORE `trim` on
    // each video input reference so the fps filter sees the original
    // source PTS (including any gaps) and resamples against them
    // correctly. Audio stays sample-accurate via plain atrim. No
    // post-concat fps filter is used — per-section CFR propagates
    // through concat to the output directly.
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
        // Take has NO start-offset shift; all three sources are anchored
        // together, which is the common case we want to lock.
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
      const start = sections[index].sourceStart.toFixed(3);
      const end = sections[index].sourceEnd.toFixed(3);
      // fps=N precedes the trim — NOT the other way around, NOT
      // post-concat. Screen and camera video both get the same
      // pre-trim CFR normalization.
      expect(argString).toContain(
        `[0:v]fps=30,trim=start=${start}:end=${end},setpts=PTS-STARTPTS,setsar=1[sv${index}]`
      );
      expect(argString).toContain(
        `[1:v]fps=30,trim=start=${start}:end=${end},setpts=PTS-STARTPTS[cv${index}]`
      );
      // Plain sample-accurate audio trim — explicitly NO apad, NO
      // atrim=duration. Audio is inherently CFR (sample-rate aligned)
      // so no preamble is needed.
      expect(argString).toContain(
        `[0:a]atrim=start=${start}:end=${end},asetpts=PTS-STARTPTS[sa${index}]`
      );
    }
    // No per-section duration-cap chains (they introduced frame-grid
    // rounding that drifted audio vs video).
    expect(argString).not.toContain('tpad=');
    expect(argString).not.toContain('trim=duration=');
    expect(argString).not.toContain('apad=');
    expect(argString).not.toContain('atrim=duration=');
    // And NO post-concat fps filter — concat feeds [screen_raw] / [camera_raw]
    // directly. Running fps after concat on an already-CFR stream is a
    // no-op at best and the direct cause of the regressed drift before
    // we moved fps pre-trim.
    expect(argString).not.toContain('screen_concat');
    expect(argString).not.toContain('camera_concat');
    expect(argString).not.toContain('[screen_raw]fps=');
    expect(argString).not.toContain('[camera_raw]fps=');
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
