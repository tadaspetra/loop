import crypto from 'node:crypto';
import path from 'node:path';

import { fs } from '../infra/file-system';
import type {
  Keyframe,
  ScreenFitMode,
  ExportAudioPreset,
  ExportVideoPreset
} from '../../shared/domain/project';
import {
  renderComposite,
  type RenderCompositeDeps,
  type RenderTakeInput
} from './render-service';

const PREVIEW_FILE_PREFIX = 'preview-';
const PREVIEW_FILE_SUFFIX = '.mp4';

/**
 * Per-take inputs that feed into the stitched preview hash. Changing any
 * value here invalidates the cached preview file so the editor never plays
 * stale content — even if the user edited the project outside the app.
 */
export interface PreviewHashTakeInput {
  id: string;
  screenStartOffsetMs?: number;
  cameraStartOffsetMs?: number;
  audioStartOffsetMs?: number;
  audioSource?: string | null;
  hasSystemAudio?: boolean;
  // File mtime is included so that if the underlying media changes (e.g. a
  // proxy regeneration that swapped the canonical file) the preview cache
  // is invalidated. Missing/unreadable files contribute null and that also
  // produces a stable hash.
  screenMtimeMs?: number | null;
  cameraMtimeMs?: number | null;
  audioMtimeMs?: number | null;
}

/**
 * Subset of a Section needed for the preview hash and render. We do not
 * care about UI-only fields like `label` or `transcript`, so those are
 * omitted to keep the cache stable across purely cosmetic edits.
 */
export interface PreviewHashSectionInput {
  takeId: string | null;
  sourceStart: number;
  sourceEnd: number;
  backgroundZoom?: number;
  backgroundPanX?: number;
  backgroundPanY?: number;
  imagePath?: string | null;
}

export interface ComputeTimelineHashInput {
  takes: PreviewHashTakeInput[];
  sections: PreviewHashSectionInput[];
  keyframes: Keyframe[];
  pipSize: number;
  screenFitMode: ScreenFitMode;
  cameraSyncOffsetMs: number;
  sourceWidth: number;
  sourceHeight: number;
}

function round(value: unknown, digits = 3): number {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  const factor = 10 ** digits;
  return Math.round(num * factor) / factor;
}

function normalizeTake(take: PreviewHashTakeInput) {
  return {
    id: typeof take?.id === 'string' ? take.id : '',
    sOff: Math.max(0, Number(take?.screenStartOffsetMs) || 0),
    cOff: Math.max(0, Number(take?.cameraStartOffsetMs) || 0),
    aOff: Math.max(0, Number(take?.audioStartOffsetMs) || 0),
    audioSource: typeof take?.audioSource === 'string' ? take.audioSource : null,
    hasSystemAudio: take?.hasSystemAudio === true,
    screenMtime: Number.isFinite(Number(take?.screenMtimeMs)) ? Number(take?.screenMtimeMs) : null,
    cameraMtime: Number.isFinite(Number(take?.cameraMtimeMs)) ? Number(take?.cameraMtimeMs) : null,
    audioMtime: Number.isFinite(Number(take?.audioMtimeMs)) ? Number(take?.audioMtimeMs) : null
  };
}

function normalizeSection(section: PreviewHashSectionInput) {
  return {
    takeId: typeof section?.takeId === 'string' ? section.takeId : null,
    start: round(section?.sourceStart, 6),
    end: round(section?.sourceEnd, 6),
    bgZoom: round(section?.backgroundZoom ?? 1, 4),
    bgPanX: round(section?.backgroundPanX ?? 0, 4),
    bgPanY: round(section?.backgroundPanY ?? 0, 4),
    image: typeof section?.imagePath === 'string' && section.imagePath ? section.imagePath : null
  };
}

function normalizeKeyframe(keyframe: Keyframe) {
  return {
    t: round(keyframe?.time, 4),
    x: Math.round(Number(keyframe?.pipX) || 0),
    y: Math.round(Number(keyframe?.pipY) || 0),
    v: keyframe?.pipVisible !== false,
    fs: keyframe?.cameraFullscreen === true,
    bgZ: round(keyframe?.backgroundZoom ?? 1, 4),
    bgX: round(keyframe?.backgroundPanX ?? 0, 4),
    bgY: round(keyframe?.backgroundPanY ?? 0, 4)
  };
}

/**
 * Returns a deterministic hex hash of every input that influences the
 * rendered preview. Input ordering is preserved (sections, keyframes,
 * takes) because reordering changes playback meaningfully. UI-only fields
 * (labels, transcripts, keyframe section linkage) are excluded so purely
 * cosmetic edits do not invalidate the cached preview.
 */
export function computeTimelineHash(input: ComputeTimelineHashInput): string {
  const takes = Array.isArray(input?.takes) ? input.takes.map(normalizeTake) : [];
  const sections = Array.isArray(input?.sections) ? input.sections.map(normalizeSection) : [];
  const keyframes = Array.isArray(input?.keyframes) ? input.keyframes.map(normalizeKeyframe) : [];

  const payload = {
    takes,
    sections,
    keyframes,
    pipSize: Math.round(Number(input?.pipSize) || 0),
    fit: input?.screenFitMode === 'fit' ? 'fit' : 'fill',
    camSync: Math.round(Number(input?.cameraSyncOffsetMs) || 0),
    w: Math.round(Number(input?.sourceWidth) || 0),
    h: Math.round(Number(input?.sourceHeight) || 0)
  };

  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex').slice(0, 16);
}

export function derivePreviewPath(projectFolder: string, hash: string): string {
  return path.join(projectFolder, `${PREVIEW_FILE_PREFIX}${hash}${PREVIEW_FILE_SUFFIX}`);
}

export function isPreviewFileName(name: string): boolean {
  return (
    typeof name === 'string' &&
    name.startsWith(PREVIEW_FILE_PREFIX) &&
    name.endsWith(PREVIEW_FILE_SUFFIX)
  );
}

export interface GeneratePreviewOpts {
  projectFolder: string;
  timelineHash: string;
  takes: RenderTakeInput[];
  sections: unknown[];
  keyframes: Keyframe[];
  pipSize: number;
  screenFitMode: ScreenFitMode;
  cameraSyncOffsetMs: number;
  sourceWidth: number;
  sourceHeight: number;
}

export interface GeneratePreviewResult {
  path: string;
  hash: string;
  // True when the preview was already cached and ffmpeg was not re-run.
  cached: boolean;
}

export interface PreviewRenderDeps {
  renderComposite?: typeof renderComposite;
  fs?: Pick<typeof fs, 'existsSync'>;
  compositeDeps?: RenderCompositeDeps;
  signal?: AbortSignal;
}

/**
 * Generate a stitched preview MP4 for the current timeline, hashed so
 * repeat calls with an identical timeline return immediately with the
 * cached file. Uses the `fast` export preset and `off` audio preset so
 * the preview lands quickly; preview sync fidelity is intentionally the
 * same as a final export since the preview shares renderComposite's
 * offset-aware filter graph.
 */
export async function generatePreview(
  opts: GeneratePreviewOpts,
  deps: PreviewRenderDeps = {}
): Promise<GeneratePreviewResult> {
  const renderImpl = deps.renderComposite ?? renderComposite;
  const fsImpl = deps.fs ?? fs;

  if (!opts?.projectFolder) throw new Error('Missing project folder');
  if (!opts?.timelineHash) throw new Error('Missing timeline hash');

  const hash = opts.timelineHash;
  const previewPath = derivePreviewPath(opts.projectFolder, hash);

  if (fsImpl.existsSync(previewPath)) {
    return { path: previewPath, hash, cached: true };
  }

  const exportAudioPreset: ExportAudioPreset = 'off';
  const exportVideoPreset: ExportVideoPreset = 'fast';

  await renderImpl(
    {
      takes: opts.takes,
      sections: opts.sections,
      keyframes: opts.keyframes,
      pipSize: opts.pipSize,
      screenFitMode: opts.screenFitMode,
      exportAudioPreset,
      exportVideoPreset,
      cameraSyncOffsetMs: opts.cameraSyncOffsetMs,
      sourceWidth: opts.sourceWidth,
      sourceHeight: opts.sourceHeight,
      outputPath: previewPath
    },
    {
      ...(deps.compositeDeps || {}),
      signal: deps.signal
    }
  );

  return { path: previewPath, hash, cached: false };
}

/**
 * Deletes stale preview files in the project folder. A preview is stale
 * when its hash does not match `currentHash`. Safe to call even if no
 * preview folder exists yet. Any ENOENT is ignored so transient races
 * between renders do not break the caller.
 */
export function cleanupStalePreviews(projectFolder: string, currentHash: string): number {
  if (!projectFolder || !fs.existsSync(projectFolder)) return 0;
  const entries = fs.readdirSync(projectFolder);
  let removed = 0;
  for (const entry of entries) {
    if (!isPreviewFileName(entry)) continue;
    const hashPart = entry.slice(PREVIEW_FILE_PREFIX.length, -PREVIEW_FILE_SUFFIX.length);
    if (hashPart === currentHash) continue;
    try {
      fs.unlinkSync(path.join(projectFolder, entry));
      removed += 1;
    } catch (_error) {
      // The file may already be gone (race with another cleanup) or locked
      // (ffmpeg writing a different preview). Either way, skipping is safe.
    }
  }
  return removed;
}
