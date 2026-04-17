import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import type { Keyframe } from '../../src/shared/domain/project';
import {
  computeTimelineHash,
  derivePreviewPath,
  generatePreview
} from '../../src/main/services/preview-render-service';

describe('main/services/preview-render-service integration', () => {
  let sandbox: string;
  let screenPath: string;
  let cameraPath: string;

  beforeEach(() => {
    sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'preview-integration-'));
    screenPath = path.join(sandbox, 'screen.webm');
    cameraPath = path.join(sandbox, 'camera.webm');
    fs.writeFileSync(screenPath, 'screen', 'utf8');
    fs.writeFileSync(cameraPath, 'camera', 'utf8');
  });

  afterEach(() => {
    fs.rmSync(sandbox, { recursive: true, force: true });
  });

  test('writes preview MP4 at deterministic hash path by driving renderComposite end-to-end', async () => {
    const keyframes = [
      { time: 0, pipX: 10, pipY: 10, pipVisible: true, cameraFullscreen: false }
    ] as Keyframe[];
    const hash = computeTimelineHash({
      takes: [
        {
          id: 'take-1',
          screenStartOffsetMs: 0,
          cameraStartOffsetMs: 80,
          audioStartOffsetMs: 0,
          audioSource: 'camera',
          hasSystemAudio: false,
          screenMtimeMs: 1000,
          cameraMtimeMs: 1000,
          audioMtimeMs: null
        }
      ],
      sections: [{ takeId: 'take-1', sourceStart: 0, sourceEnd: 1 }],
      keyframes,
      pipSize: 400,
      screenFitMode: 'fill',
      cameraSyncOffsetMs: 0,
      sourceWidth: 1920,
      sourceHeight: 1080
    });

    const capturedArgs: string[] = [];

    const result = await generatePreview(
      {
        projectFolder: sandbox,
        timelineHash: hash,
        takes: [
          {
            id: 'take-1',
            screenPath,
            cameraPath,
            cameraStartOffsetMs: 80,
            audioSource: 'camera'
          }
        ],
        sections: [{ takeId: 'take-1', sourceStart: 0, sourceEnd: 1 }],
        keyframes,
        pipSize: 400,
        screenFitMode: 'fill',
        cameraSyncOffsetMs: 0,
        sourceWidth: 1920,
        sourceHeight: 1080
      },
      {
        compositeDeps: {
          ffmpegPath: '/usr/bin/ffmpeg',
          probeVideoFpsWithFfmpeg: async () => 30,
          now: () => 111,
          runFfmpeg: async ({ args = [] } = {}) => {
            // Simulate ffmpeg running successfully by creating the expected
            // output file at the path the filter graph names. The filter
            // graph's last -y argument is the output file.
            const yIndex = args.indexOf('-y');
            const outPath = yIndex >= 0 ? args[yIndex + 1] : '';
            if (outPath) fs.writeFileSync(outPath, 'fake-mp4', 'utf8');
            capturedArgs.push(args.join(' '));
            return { stderr: '' };
          }
        }
      }
    );

    expect(result.cached).toBe(false);
    expect(result.hash).toBe(hash);
    expect(result.path).toBe(derivePreviewPath(sandbox, hash));
    expect(fs.existsSync(result.path)).toBe(true);

    // The filter graph must include the per-recorder camera shift (80ms)
    // so the preview stays sample-accurate. The shifted window starts
    // 80ms before the source's t=0, so start_duration=0.080 clone-pads the
    // missing prefix; no stop pad is needed because the shifted window
    // still fits inside the source's tail. trim=duration caps the section
    // to the nominal 1.000s.
    expect(capturedArgs).toHaveLength(1);
    expect(capturedArgs[0]).toContain(
      '[1:v]fps=30,trim=start=0.000:end=0.920,setpts=PTS-STARTPTS,tpad=start_mode=clone:start_duration=0.080:stop_mode=clone:stop_duration=0.000,trim=duration=1.000,setpts=PTS-STARTPTS[cv0]'
    );
    // Post-concat fps normalization applies to the preview too.
    // fps normalization is applied BEFORE per-section trim (`[N:v]fps=30,trim=...`)
    // so concat directly yields [screen_raw]; there is no intermediate
    // [screen_concat] + post-concat fps filter.
    expect(capturedArgs[0]).toContain('concat=n=1:v=1:a=1[screen_raw][audio_out]');
    expect(capturedArgs[0]).not.toContain('screen_concat');
    // Preview runs the fast export preset: veryfast preset, crf 24.
    expect(capturedArgs[0]).toContain('-preset veryfast');
    expect(capturedArgs[0]).toContain('-crf 24');

    // Second call with the same hash must short-circuit — no additional
    // ffmpeg invocation, cached flag is set, file stays in place.
    let secondRun = false;
    const cached = await generatePreview(
      {
        projectFolder: sandbox,
        timelineHash: hash,
        takes: [{ id: 'take-1', screenPath, cameraPath, audioSource: 'camera' }],
        sections: [{ takeId: 'take-1', sourceStart: 0, sourceEnd: 1 }],
        keyframes,
        pipSize: 400,
        screenFitMode: 'fill',
        cameraSyncOffsetMs: 0,
        sourceWidth: 1920,
        sourceHeight: 1080
      },
      {
        compositeDeps: {
          ffmpegPath: '/usr/bin/ffmpeg',
          probeVideoFpsWithFfmpeg: async () => 30,
          runFfmpeg: async () => {
            secondRun = true;
            return { stderr: '' };
          }
        }
      }
    );

    expect(secondRun).toBe(false);
    expect(cached.cached).toBe(true);
  });
});
