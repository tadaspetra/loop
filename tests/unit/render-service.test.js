const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  normalizeSectionInput,
  assertFilePath,
  renderComposite
} = require('../../src/main/services/render-service');

describe('main/services/render-service', () => {
  test('normalizeSectionInput filters invalid sections', () => {
    const sections = normalizeSectionInput([
      { takeId: 'a', sourceStart: 0, sourceEnd: 1, backgroundZoom: 1.75, backgroundPanX: 0.5, backgroundPanY: -0.3 },
      { takeId: 'b', sourceStart: 2, sourceEnd: 1 },
      { takeId: 'c', sourceStart: 'x', sourceEnd: 3 },
      { takeId: 'd', sourceStart: 0, sourceEnd: 2, backgroundZoom: 10, backgroundPanX: -9, backgroundPanY: 8 }
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
          runFfmpeg: async () => {}
        }
      )
    ).rejects.toThrow(/Take missing not found/);
  });

  test('renderComposite builds ffmpeg args and resolves output path', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'video-render-run-'));
    const outputDir = path.join(tmpDir, 'out');
    const screenPath = path.join(tmpDir, 'screen.webm');
    fs.writeFileSync(screenPath, 'screen', 'utf8');

    const execCalls = [];
    const output = await renderComposite(
      {
        outputFolder: outputDir,
        takes: [{ id: 'take-1', screenPath, cameraPath: null }],
        sections: [{ takeId: 'take-1', sourceStart: 0, sourceEnd: 1.25 }],
        keyframes: [{ time: 0, pipX: 10, pipY: 10, pipVisible: false, cameraFullscreen: false }],
        pipSize: 300,
        sourceWidth: 1920,
        sourceHeight: 1080,
        screenFitMode: 'fill'
      },
      {
        ffmpegPath: '/usr/bin/ffmpeg',
        now: () => 123,
        probeVideoFpsWithFfmpeg: async () => 29.97,
        runFfmpeg: async ({ ffmpegPath, args }) => {
          execCalls.push({ bin: ffmpegPath, args });
        }
      }
    );

    expect(output).toBe(path.join(outputDir, 'recording-123-edited.mp4'));
    expect(execCalls).toHaveLength(1);
    expect(execCalls[0].bin).toBe('/usr/bin/ffmpeg');
    expect(execCalls[0].args.join(' ')).toContain('-filter_complex');
    expect(execCalls[0].args.join(' ')).toContain('[audio_out]acompressor=');
    expect(execCalls[0].args.join(' ')).toContain('-map [audio_final]');
    expect(execCalls[0].args).toEqual(
      expect.arrayContaining([
        '-progress',
        'pipe:1',
        '-nostats',
        '-c:v',
        'libx264',
        '-crf',
        '12',
        '-preset',
        'slow',
        '-c:a',
        'aac',
        '-b:a',
        '192k'
      ])
    );
  });

  test('renderComposite keeps default audio mapping when export audio preset is off', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'video-render-audio-off-'));
    const outputDir = path.join(tmpDir, 'out');
    const screenPath = path.join(tmpDir, 'screen.webm');
    fs.writeFileSync(screenPath, 'screen', 'utf8');

    const execCalls = [];
    await renderComposite(
      {
        outputFolder: outputDir,
        takes: [{ id: 'take-1', screenPath, cameraPath: null }],
        sections: [{ takeId: 'take-1', sourceStart: 0, sourceEnd: 1.25 }],
        keyframes: [{ time: 0, pipX: 10, pipY: 10, pipVisible: false, cameraFullscreen: false }],
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
        runFfmpeg: async ({ ffmpegPath, args }) => {
          execCalls.push({ bin: ffmpegPath, args });
        }
      }
    );

    const argString = execCalls[0].args.join(' ');
    expect(argString).toContain('[screen_audio_out]anull[audio_out]');
    expect(argString).toContain('-map [audio_out]');
    expect(argString).not.toContain('acompressor=');
    expect(argString).not.toContain('[audio_final]');
  });

  test('renderComposite applies compressor filter when export audio preset is compressed', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'video-render-audio-compressed-'));
    const outputDir = path.join(tmpDir, 'out');
    const screenPath = path.join(tmpDir, 'screen.webm');
    fs.writeFileSync(screenPath, 'screen', 'utf8');

    const execCalls = [];
    await renderComposite(
      {
        outputFolder: outputDir,
        takes: [{ id: 'take-1', screenPath, cameraPath: null }],
        sections: [{ takeId: 'take-1', sourceStart: 0, sourceEnd: 1.25 }],
        keyframes: [{ time: 0, pipX: 10, pipY: 10, pipVisible: false, cameraFullscreen: false }],
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
        runFfmpeg: async ({ ffmpegPath, args }) => {
          execCalls.push({ bin: ffmpegPath, args });
        }
      }
    );

    const argString = execCalls[0].args.join(' ');
    expect(argString).toContain('[audio_out]acompressor=');
    expect(argString).toContain('[audio_final]');
    expect(argString).toContain('-map [audio_final]');
  });

  test('renderComposite mixes microphone audio with screen audio when micPath is present', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'video-render-mic-mix-'));
    const outputDir = path.join(tmpDir, 'out');
    const screenPath = path.join(tmpDir, 'screen.webm');
    const micPath = path.join(tmpDir, 'mic.webm');
    fs.writeFileSync(screenPath, 'screen', 'utf8');
    fs.writeFileSync(micPath, 'mic', 'utf8');

    const execCalls = [];
    await renderComposite(
      {
        outputFolder: outputDir,
        takes: [{ id: 'take-1', screenPath, cameraPath: null, micPath }],
        sections: [{ takeId: 'take-1', sourceStart: 0, sourceEnd: 1.25 }],
        keyframes: [{ time: 0, pipX: 10, pipY: 10, pipVisible: false, cameraFullscreen: false }],
        pipSize: 300,
        sourceWidth: 1920,
        sourceHeight: 1080,
        screenFitMode: 'fill',
        exportAudioPreset: 'off'
      },
      {
        ffmpegPath: '/usr/bin/ffmpeg',
        now: () => 741,
        probeVideoFpsWithFfmpeg: async () => 30,
        runFfmpeg: async ({ ffmpegPath, args }) => {
          execCalls.push({ bin: ffmpegPath, args });
        }
      }
    );

    const args = execCalls[0].args;
    const argString = args.join(' ');
    expect(args.filter((value) => value === '-i')).toHaveLength(2);
    expect(args).toEqual(expect.arrayContaining([screenPath, micPath]));
    expect(argString).toContain('[0:a]atrim=start=0.000:end=1.250,asetpts=PTS-STARTPTS[sa0]');
    expect(argString).toContain('[1:a]atrim=start=0.000:end=1.250,asetpts=PTS-STARTPTS[ma0]');
    expect(argString).toContain('[sa0]concat=n=1:v=0:a=1[screen_audio_out]');
    expect(argString).toContain('[ma0]concat=n=1:v=0:a=1[mic_audio_out]');
    expect(argString).toContain('[screen_audio_out][mic_audio_out]amix=inputs=2:weights=1 1:normalize=0[audio_out]');
  });

  test('renderComposite falls back to mic audio when screen recording has no system audio', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'video-render-mic-only-'));
    const outputDir = path.join(tmpDir, 'out');
    const screenPath = path.join(tmpDir, 'screen.webm');
    const micPath = path.join(tmpDir, 'mic.webm');
    fs.writeFileSync(screenPath, 'screen', 'utf8');
    fs.writeFileSync(micPath, 'mic', 'utf8');

    const execCalls = [];
    await renderComposite(
      {
        outputFolder: outputDir,
        takes: [{ id: 'take-1', screenPath, cameraPath: null, micPath, screenHasAudio: false }],
        sections: [{ takeId: 'take-1', sourceStart: 0, sourceEnd: 1.25 }],
        keyframes: [{ time: 0, pipX: 10, pipY: 10, pipVisible: false, cameraFullscreen: false }],
        pipSize: 300,
        sourceWidth: 1920,
        sourceHeight: 1080,
        screenFitMode: 'fill',
        exportAudioPreset: 'off'
      },
      {
        ffmpegPath: '/usr/bin/ffmpeg',
        now: () => 852,
        probeVideoFpsWithFfmpeg: async () => 30,
        runFfmpeg: async ({ ffmpegPath, args }) => {
          execCalls.push({ bin: ffmpegPath, args });
        }
      }
    );

    const args = execCalls[0].args;
    const argString = args.join(' ');
    expect(args.filter((value) => value === '-i')).toHaveLength(2);
    expect(argString).toContain('anullsrc=channel_layout=stereo:sample_rate=48000,atrim=duration=1.250,asetpts=PTS-STARTPTS[sa0]');
    expect(argString).toContain('[1:a]atrim=start=0.000:end=1.250,asetpts=PTS-STARTPTS[ma0]');
    expect(argString).toContain('[screen_audio_out][mic_audio_out]amix=inputs=2:weights=1 1:normalize=0[audio_out]');
  });

  test('renderComposite applies section zoom to background only', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'video-render-zoom-'));
    const outputDir = path.join(tmpDir, 'out');
    const screenPath = path.join(tmpDir, 'screen.webm');
    const cameraPath = path.join(tmpDir, 'camera.webm');
    fs.writeFileSync(screenPath, 'screen', 'utf8');
    fs.writeFileSync(cameraPath, 'camera', 'utf8');

    const execCalls = [];
    await renderComposite(
      {
        outputFolder: outputDir,
        takes: [{ id: 'take-1', screenPath, cameraPath }],
        sections: [{ takeId: 'take-1', sourceStart: 0, sourceEnd: 1.0, backgroundZoom: 2 }],
        keyframes: [{ time: 0, pipX: 10, pipY: 10, pipVisible: true, cameraFullscreen: false, backgroundZoom: 2, backgroundPanX: 0, backgroundPanY: 0 }],
        pipSize: 300,
        sourceWidth: 1920,
        sourceHeight: 1080,
        screenFitMode: 'fill'
      },
      {
        ffmpegPath: '/usr/bin/ffmpeg',
        now: () => 456,
        probeVideoFpsWithFfmpeg: async () => 30,
        runFfmpeg: async ({ ffmpegPath, args }) => {
          execCalls.push({ bin: ffmpegPath, args });
        }
      }
    );

    const argString = execCalls[0].args.join(' ');
    expect(argString).toContain("[screen_raw]setpts=PTS-STARTPTS[screen_base];[screen_base]zoompan=z='2.000'");
    expect(argString).toContain('[1:v]trim=start=0.000:end=1.000,setpts=PTS-STARTPTS,fps=fps=30[cv0]');
    expect(argString).not.toContain('scale=3840:2160,crop=1920:1080:960:540[cv0]');
  });

  test('renderComposite advances camera video when camera sync offset is positive', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'video-render-camera-sync-'));
    const outputDir = path.join(tmpDir, 'out');
    const screenPath = path.join(tmpDir, 'screen.webm');
    const cameraPath = path.join(tmpDir, 'camera.webm');
    fs.writeFileSync(screenPath, 'screen', 'utf8');
    fs.writeFileSync(cameraPath, 'camera', 'utf8');

    const execCalls = [];
    await renderComposite(
      {
        outputFolder: outputDir,
        takes: [{ id: 'take-1', screenPath, cameraPath }],
        sections: [{ takeId: 'take-1', sourceStart: 0, sourceEnd: 1.0 }],
        keyframes: [{ time: 0, pipX: 10, pipY: 10, pipVisible: true, cameraFullscreen: false }],
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
        runFfmpeg: async ({ ffmpegPath, args }) => {
          execCalls.push({ bin: ffmpegPath, args });
        }
      }
    );

    const argString = execCalls[0].args.join(' ');
    expect(argString).toContain('[1:v]trim=start=0.120:end=1.120,setpts=PTS-STARTPTS,tpad=start_mode=clone:start_duration=0.000:stop_mode=clone:stop_duration=0.120,trim=duration=1.000,setpts=PTS-STARTPTS,fps=fps=30[cv0]');
  });

  test('renderComposite applies clamped section pan to background crop', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'video-render-pan-'));
    const outputDir = path.join(tmpDir, 'out');
    const screenPath = path.join(tmpDir, 'screen.webm');
    fs.writeFileSync(screenPath, 'screen', 'utf8');

    const execCalls = [];
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
        keyframes: [{ time: 0, pipX: 10, pipY: 10, pipVisible: false, cameraFullscreen: false, backgroundZoom: 2, backgroundPanX: 1, backgroundPanY: -1 }],
        pipSize: 300,
        sourceWidth: 1920,
        sourceHeight: 1080,
        screenFitMode: 'fill'
      },
      {
        ffmpegPath: '/usr/bin/ffmpeg',
        now: () => 789,
        probeVideoFpsWithFfmpeg: async () => 30,
        runFfmpeg: async ({ ffmpegPath, args }) => {
          execCalls.push({ bin: ffmpegPath, args });
        }
      }
    );

    const argString = execCalls[0].args.join(' ');
    expect(argString).toContain("zoompan=z='2.000':x='max(0,min(iw-iw/zoom,iw*(0.750000)-iw/zoom/2))':y='max(0,min(ih-ih/zoom,ih*(0.250000)-ih/zoom/2))'");
  });

  test('renderComposite animates background zoom and pan through section boundaries', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'video-render-animated-bg-'));
    const outputDir = path.join(tmpDir, 'out');
    const screenPath = path.join(tmpDir, 'screen.webm');
    fs.writeFileSync(screenPath, 'screen', 'utf8');

    const execCalls = [];
    await renderComposite(
      {
        outputFolder: outputDir,
        takes: [{ id: 'take-1', screenPath, cameraPath: null }],
        sections: [
          { takeId: 'take-1', sourceStart: 0, sourceEnd: 1.0, backgroundZoom: 1, backgroundPanX: 0, backgroundPanY: 0 },
          { takeId: 'take-1', sourceStart: 1.0, sourceEnd: 2.0, backgroundZoom: 2, backgroundPanX: 1, backgroundPanY: -1 }
        ],
        keyframes: [
          { time: 0, pipX: 10, pipY: 10, pipVisible: false, cameraFullscreen: false, backgroundZoom: 1, backgroundPanX: 0, backgroundPanY: 0 },
          { time: 1, pipX: 10, pipY: 10, pipVisible: false, cameraFullscreen: false, backgroundZoom: 2, backgroundPanX: 1, backgroundPanY: -1 }
        ],
        pipSize: 300,
        sourceWidth: 1920,
        sourceHeight: 1080,
        screenFitMode: 'fill'
      },
      {
        ffmpegPath: '/usr/bin/ffmpeg',
        now: () => 999,
        probeVideoFpsWithFfmpeg: async () => 30,
        runFfmpeg: async ({ ffmpegPath, args }) => {
          execCalls.push({ bin: ffmpegPath, args });
        }
      }
    );

    const argString = execCalls[0].args.join(' ');
    expect(argString).toContain('if(gte(it,1.000),2.000');
    expect(argString).toContain('if(gte(it,0.700),1.000+1.000*(it-0.700)/0.300');
  });

  test('renderComposite reuses ffmpeg inputs for repeated sections from the same take', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'video-render-dedupe-'));
    const outputDir = path.join(tmpDir, 'out');
    const screenPath = path.join(tmpDir, 'screen.webm');
    const cameraPath = path.join(tmpDir, 'camera.webm');
    fs.writeFileSync(screenPath, 'screen', 'utf8');
    fs.writeFileSync(cameraPath, 'camera', 'utf8');

    const execCalls = [];
    await renderComposite(
      {
        outputFolder: outputDir,
        takes: [{ id: 'take-1', screenPath, cameraPath }],
        sections: [
          { takeId: 'take-1', sourceStart: 0, sourceEnd: 1.0 },
          { takeId: 'take-1', sourceStart: 1.0, sourceEnd: 2.0 }
        ],
        keyframes: [{ time: 0, pipX: 10, pipY: 10, pipVisible: true, cameraFullscreen: false }],
        pipSize: 300,
        sourceWidth: 1920,
        sourceHeight: 1080,
        screenFitMode: 'fill'
      },
      {
        ffmpegPath: '/usr/bin/ffmpeg',
        now: () => 222,
        probeVideoFpsWithFfmpeg: async () => 30,
        runFfmpeg: async ({ ffmpegPath, args }) => {
          execCalls.push({ bin: ffmpegPath, args });
        }
      }
    );

    const args = execCalls[0].args;
    expect(args.filter((value) => value === '-i')).toHaveLength(2);
    expect(args.filter((value) => value === screenPath)).toHaveLength(1);
    expect(args.filter((value) => value === cameraPath)).toHaveLength(1);

    const argString = args.join(' ');
    expect(argString).toContain('[0:v]trim=start=0.000:end=1.000,setpts=PTS-STARTPTS,fps=fps=30,setsar=1[sv0]');
    expect(argString).toContain('[0:v]trim=start=1.000:end=2.000,setpts=PTS-STARTPTS,fps=fps=30,setsar=1[sv1]');
    expect(argString).toContain('[1:v]trim=start=0.000:end=1.000,setpts=PTS-STARTPTS,fps=fps=30[cv0]');
    expect(argString).toContain('[1:v]trim=start=1.000:end=2.000,setpts=PTS-STARTPTS,fps=fps=30[cv1]');
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

    const execCalls = [];
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
        keyframes: [{ time: 0, pipX: 10, pipY: 10, pipVisible: true, cameraFullscreen: false }],
        pipSize: 300,
        sourceWidth: 1920,
        sourceHeight: 1080,
        screenFitMode: 'fill'
      },
      {
        ffmpegPath: '/usr/bin/ffmpeg',
        now: () => 333,
        probeVideoFpsWithFfmpeg: async () => 30,
        runFfmpeg: async ({ ffmpegPath, args }) => {
          execCalls.push({ bin: ffmpegPath, args });
        }
      }
    );

    const argString = execCalls[0].args.join(' ');
    expect(execCalls[0].args.filter((value) => value === '-i')).toHaveLength(4);
    expect(argString).toContain('[0:v]trim=start=0.000:end=1.000,setpts=PTS-STARTPTS,fps=fps=30,setsar=1[sv0]');
    expect(argString).toContain('[2:v]trim=start=1.000:end=2.000,setpts=PTS-STARTPTS,fps=fps=30,setsar=1[sv1]');
    expect(argString).toContain('[0:v]trim=start=2.000:end=3.000,setpts=PTS-STARTPTS,fps=fps=30,setsar=1[sv2]');
    expect(argString).toContain('[1:v]trim=start=0.000:end=1.000,setpts=PTS-STARTPTS,fps=fps=30[cv0]');
    expect(argString).toContain('[3:v]trim=start=1.000:end=2.000,setpts=PTS-STARTPTS,fps=fps=30[cv1]');
    expect(argString).toContain('[1:v]trim=start=2.000:end=3.000,setpts=PTS-STARTPTS,fps=fps=30[cv2]');
  });

  test('renderComposite forwards mapped progress updates from ffmpeg output time', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'video-render-progress-'));
    const outputDir = path.join(tmpDir, 'out');
    const screenPath = path.join(tmpDir, 'screen.webm');
    fs.writeFileSync(screenPath, 'screen', 'utf8');

    const updates = [];
    await renderComposite(
      {
        outputFolder: outputDir,
        takes: [{ id: 'take-1', screenPath, cameraPath: null }],
        sections: [{ takeId: 'take-1', sourceStart: 0, sourceEnd: 4.0 }],
        keyframes: [{ time: 0, pipX: 10, pipY: 10, pipVisible: false, cameraFullscreen: false }],
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
        runFfmpeg: async ({ onProgress }) => {
          onProgress({ status: 'continue', outTimeSec: 2, frame: 48, speed: 1.1 });
          onProgress({ status: 'end', outTimeSec: 4, frame: 96, speed: 0.9 });
        }
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
});
