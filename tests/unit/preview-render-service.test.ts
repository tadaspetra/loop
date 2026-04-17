import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, test } from 'vitest';

import type { Keyframe } from '../../src/shared/domain/project';
import {
  cleanupStalePreviews,
  computeTimelineHash,
  derivePreviewPath,
  generatePreview,
  isPreviewFileName
} from '../../src/main/services/preview-render-service';

function defaultHashInput() {
  return {
    takes: [
      {
        id: 'take-1',
        screenStartOffsetMs: 0,
        cameraStartOffsetMs: 0,
        audioStartOffsetMs: 0,
        audioSource: 'camera',
        hasSystemAudio: false,
        screenMtimeMs: 1000,
        cameraMtimeMs: 1000,
        audioMtimeMs: null
      }
    ],
    sections: [
      { takeId: 'take-1', sourceStart: 0, sourceEnd: 5 }
    ],
    keyframes: [
      { time: 0, pipX: 10, pipY: 20, pipVisible: true, cameraFullscreen: false }
    ] as Keyframe[],
    pipSize: 400,
    screenFitMode: 'fill' as const,
    cameraSyncOffsetMs: 0,
    sourceWidth: 1920,
    sourceHeight: 1080
  };
}

describe('main/services/preview-render-service', () => {
  describe('computeTimelineHash', () => {
    test('is deterministic for identical inputs', () => {
      const input = defaultHashInput();
      expect(computeTimelineHash(input)).toBe(computeTimelineHash(input));
    });

    test('is stable under UI-only keyframe changes (labels, transcripts, sectionId)', () => {
      const base = defaultHashInput();
      const withUiDrift = {
        ...base,
        sections: base.sections.map((s) => ({
          ...s,
          // Label/transcript should NOT affect the render output and so
          // should NOT invalidate the cached preview.
          label: 'cosmetic',
          transcript: 'some transcript'
        })),
        keyframes: base.keyframes.map((kf) => ({
          ...kf,
          sectionId: 'section-1',
          autoSection: true
        })) as Keyframe[]
      };
      expect(computeTimelineHash(withUiDrift)).toBe(computeTimelineHash(base));
    });

    test('changes when section source windows change', () => {
      const base = defaultHashInput();
      const widened = {
        ...base,
        sections: [{ takeId: 'take-1', sourceStart: 0, sourceEnd: 6 }]
      };
      expect(computeTimelineHash(widened)).not.toBe(computeTimelineHash(base));
    });

    test('changes when keyframe positions change', () => {
      const base = defaultHashInput();
      const moved = {
        ...base,
        keyframes: [
          { time: 0, pipX: 999, pipY: 20, pipVisible: true, cameraFullscreen: false }
        ] as Keyframe[]
      };
      expect(computeTimelineHash(moved)).not.toBe(computeTimelineHash(base));
    });

    test('changes when camera start offset changes (preview must be re-rendered)', () => {
      const base = defaultHashInput();
      const shifted = {
        ...base,
        takes: [{ ...base.takes[0], cameraStartOffsetMs: 150 }]
      };
      expect(computeTimelineHash(shifted)).not.toBe(computeTimelineHash(base));
    });

    test('changes when source file mtime changes (e.g. proxy regeneration)', () => {
      const base = defaultHashInput();
      const newerScreen = {
        ...base,
        takes: [{ ...base.takes[0], screenMtimeMs: 2000 }]
      };
      expect(computeTimelineHash(newerScreen)).not.toBe(computeTimelineHash(base));
    });

    test('is 16 hex characters long regardless of input size', () => {
      const short = computeTimelineHash(defaultHashInput());
      const big = computeTimelineHash({
        ...defaultHashInput(),
        keyframes: Array.from({ length: 200 }, (_, index) => ({
          time: index,
          pipX: index,
          pipY: index,
          pipVisible: true,
          cameraFullscreen: false
        })) as Keyframe[]
      });
      expect(short).toMatch(/^[a-f0-9]{16}$/);
      expect(big).toMatch(/^[a-f0-9]{16}$/);
    });
  });

  describe('isPreviewFileName', () => {
    test('recognizes preview files but rejects other folder contents', () => {
      expect(isPreviewFileName('preview-abcdef0123456789.mp4')).toBe(true);
      expect(isPreviewFileName('preview-.mp4')).toBe(true);
      expect(isPreviewFileName('preview-abc.mp4.tmp')).toBe(false);
      expect(isPreviewFileName('recording-1234-edited.mp4')).toBe(false);
      expect(isPreviewFileName('project.json')).toBe(false);
    });
  });

  describe('derivePreviewPath', () => {
    test('names the preview file after the hash inside the project folder', () => {
      expect(derivePreviewPath('/tmp/project', 'abc123')).toBe(
        path.join('/tmp/project', 'preview-abc123.mp4')
      );
    });
  });

  describe('generatePreview', () => {
    test('returns cached when file already exists for the hash (no ffmpeg run)', async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'preview-cached-'));
      const hash = computeTimelineHash(defaultHashInput());
      fs.writeFileSync(derivePreviewPath(dir, hash), 'existing', 'utf8');

      let rendered = false;
      const result = await generatePreview(
        {
          projectFolder: dir,
          timelineHash: hash,
          takes: [],
          sections: [{ takeId: 'take-1', sourceStart: 0, sourceEnd: 1 }],
          keyframes: [],
          pipSize: 400,
          screenFitMode: 'fill',
          cameraSyncOffsetMs: 0,
          sourceWidth: 1920,
          sourceHeight: 1080
        },
        {
          renderComposite: (async () => {
            rendered = true;
            return derivePreviewPath(dir, hash);
          }) as unknown as typeof import('../../src/main/services/render-service').renderComposite
        }
      );

      expect(rendered).toBe(false);
      expect(result.cached).toBe(true);
      expect(result.path).toBe(derivePreviewPath(dir, hash));
      fs.rmSync(dir, { recursive: true, force: true });
    });

    test('delegates to renderComposite with fast preset when the preview does not exist yet', async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'preview-miss-'));
      const hash = 'deadbeefcafebabe';
      const previewPath = derivePreviewPath(dir, hash);

      const calls: Array<{ outputPath?: string; exportVideoPreset?: string; exportAudioPreset?: string }> = [];
      await generatePreview(
        {
          projectFolder: dir,
          timelineHash: hash,
          takes: [],
          sections: [{ takeId: 'take-1', sourceStart: 0, sourceEnd: 1 }],
          keyframes: [],
          pipSize: 400,
          screenFitMode: 'fill',
          cameraSyncOffsetMs: 0,
          sourceWidth: 1920,
          sourceHeight: 1080
        },
        {
          renderComposite: (async (opts: Record<string, unknown>) => {
            calls.push({
              outputPath: opts?.outputPath as string,
              exportVideoPreset: opts?.exportVideoPreset as string,
              exportAudioPreset: opts?.exportAudioPreset as string
            });
            fs.writeFileSync(previewPath, 'rendered', 'utf8');
            return previewPath;
          }) as unknown as typeof import('../../src/main/services/render-service').renderComposite
        }
      );

      expect(calls).toHaveLength(1);
      expect(calls[0].outputPath).toBe(previewPath);
      expect(calls[0].exportVideoPreset).toBe('fast');
      // Audio is off for the preview so the render finishes faster and
      // matches preview-only use (not final export).
      expect(calls[0].exportAudioPreset).toBe('off');

      fs.rmSync(dir, { recursive: true, force: true });
    });
  });

  describe('cleanupStalePreviews', () => {
    test('removes preview files whose hash does not match the current timeline', () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'preview-cleanup-'));
      fs.writeFileSync(path.join(dir, 'preview-staleone.mp4'), 'stale', 'utf8');
      fs.writeFileSync(path.join(dir, 'preview-currenthash.mp4'), 'current', 'utf8');
      fs.writeFileSync(path.join(dir, 'project.json'), '{}', 'utf8');

      const removed = cleanupStalePreviews(dir, 'currenthash');
      expect(removed).toBe(1);
      // Current preview must survive.
      expect(fs.existsSync(path.join(dir, 'preview-currenthash.mp4'))).toBe(true);
      // Stale preview was removed.
      expect(fs.existsSync(path.join(dir, 'preview-staleone.mp4'))).toBe(false);
      // Unrelated project files must not be touched by cleanup.
      expect(fs.existsSync(path.join(dir, 'project.json'))).toBe(true);

      fs.rmSync(dir, { recursive: true, force: true });
    });

    test('returns 0 safely when the project folder is missing', () => {
      expect(cleanupStalePreviews('/definitely/not/a/real/path', 'x')).toBe(0);
    });
  });
});
