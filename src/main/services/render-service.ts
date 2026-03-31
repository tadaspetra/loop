import path from 'node:path';

import ffmpegStatic from 'ffmpeg-static';

import { ensureDirectory, fs } from '../infra/file-system';
import {
  EXPORT_AUDIO_PRESET_COMPRESSED,
  normalizeBackgroundPan,
  normalizeBackgroundZoom,
  normalizeCameraSyncOffsetMs,
  normalizeExportAudioPreset,
  normalizeExportVideoPreset,
  type ExportAudioPreset,
  type ExportVideoPreset,
  type Keyframe,
  type ScreenFitMode
} from '../../shared/domain/project';
import type { RenderProgressUpdate } from '../../shared/electron-api';
import { chooseRenderFps, probeVideoFpsWithFfmpeg } from './fps-service';
import { runFfmpeg, type FfmpegProgress } from './ffmpeg-runner';
import { buildFilterComplex, buildScreenFilter } from './render-filter-service';

export interface RenderSectionInput {
  takeId: string | null;
  sourceStart: number;
  sourceEnd: number;
  backgroundZoom: number;
  backgroundPanX: number;
  backgroundPanY: number;
  imagePath: string | null;
}

export interface RenderTakeInput {
  id: string;
  screenPath: string | null;
  cameraPath: string | null;
}

export interface RenderCompositeOptions {
  takes?: RenderTakeInput[];
  sections?: unknown[];
  keyframes?: Keyframe[];
  pipSize?: number;
  screenFitMode?: ScreenFitMode;
  exportAudioPreset?: ExportAudioPreset;
  exportVideoPreset?: ExportVideoPreset;
  cameraSyncOffsetMs?: number;
  sourceWidth?: number;
  sourceHeight?: number;
  outputFolder?: string;
}

export interface RenderCompositeDeps {
  probeVideoFpsWithFfmpeg?: typeof probeVideoFpsWithFfmpeg;
  runFfmpeg?: typeof runFfmpeg;
  ffmpegPath?: string | null;
  now?: () => number;
  onProgress?: (progress: RenderProgressUpdate) => void;
}

const MAX_OVERLAY_FILTER_LENGTH = 100000;

interface RenderVideoConfig {
  maxWidth: number;
  maxHeight: number;
  minWidth: number;
  minHeight: number;
  crf: string;
  preset: string;
  pixelFormat: string;
  audioBitrate: string;
}

const QUALITY_RENDER_CONFIG: RenderVideoConfig = {
  maxWidth: 2560,
  maxHeight: 1440,
  minWidth: 1920,
  minHeight: 1080,
  crf: '8',
  preset: 'slow',
  pixelFormat: 'yuv420p',
  audioBitrate: '192k'
};

const FAST_RENDER_CONFIG: RenderVideoConfig = {
  maxWidth: 1280,
  maxHeight: 720,
  minWidth: 2,
  minHeight: 2,
  crf: '24',
  preset: 'veryfast',
  pixelFormat: 'yuv420p',
  audioBitrate: '128k'
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function roundDownToEven(value: number): number {
  const rounded = Math.floor(value);
  if (rounded <= 2) return 2;
  return rounded % 2 === 0 ? rounded : rounded - 1;
}

function getRenderVideoConfig(exportVideoPreset: ExportVideoPreset): RenderVideoConfig {
  return exportVideoPreset === 'fast' ? FAST_RENDER_CONFIG : QUALITY_RENDER_CONFIG;
}

export function deriveRenderCanvasSize(
  sourceWidth: number,
  sourceHeight: number,
  exportVideoPreset: ExportVideoPreset = 'quality'
) {
  const config = getRenderVideoConfig(exportVideoPreset);
  const normalizedWidth = Number(sourceWidth);
  const normalizedHeight = Number(sourceHeight);
  if (
    !Number.isFinite(normalizedWidth) ||
    !Number.isFinite(normalizedHeight) ||
    normalizedWidth <= 0 ||
    normalizedHeight <= 0
  ) {
    return { canvasW: config.minWidth, canvasH: config.minHeight };
  }

  const boundedWidth = roundDownToEven(Math.min(normalizedWidth, config.maxWidth));
  const boundedHeight = roundDownToEven(Math.min(normalizedHeight, config.maxHeight));
  if (boundedWidth < config.minWidth || boundedHeight < config.minHeight) {
    return { canvasW: config.minWidth, canvasH: config.minHeight };
  }

  const fitHeight = roundDownToEven((boundedWidth * 9) / 16);
  const fitWidth = roundDownToEven((boundedHeight * 16) / 9);
  const candidates = [
    fitHeight <= boundedHeight ? { canvasW: boundedWidth, canvasH: fitHeight } : null,
    fitWidth <= boundedWidth ? { canvasW: fitWidth, canvasH: boundedHeight } : null
  ].filter((candidate): candidate is { canvasW: number; canvasH: number } => Boolean(candidate));

  const bestFit = candidates.reduce<{ canvasW: number; canvasH: number } | null>(
    (best, candidate) => {
      if (!best) return candidate;
      return candidate.canvasW * candidate.canvasH > best.canvasW * best.canvasH ? candidate : best;
    },
    null
  );

  if (!bestFit || bestFit.canvasW < config.minWidth || bestFit.canvasH < config.minHeight) {
    return { canvasW: config.minWidth, canvasH: config.minHeight };
  }

  return bestFit;
}

export function normalizeSectionInput(rawSections: unknown): RenderSectionInput[] {
  const sections = Array.isArray(rawSections) ? rawSections : [];
  return sections
    .map((rawSection) => {
      if (!isRecord(rawSection)) return null;
      const sourceStart = Number(rawSection.sourceStart);
      const sourceEnd = Number(rawSection.sourceEnd);
      if (
        !Number.isFinite(sourceStart) ||
        !Number.isFinite(sourceEnd) ||
        sourceEnd <= sourceStart
      ) {
        return null;
      }
      return {
        takeId: typeof rawSection.takeId === 'string' ? rawSection.takeId : null,
        sourceStart,
        sourceEnd,
        backgroundZoom: normalizeBackgroundZoom(rawSection.backgroundZoom),
        backgroundPanX: normalizeBackgroundPan(rawSection.backgroundPanX),
        backgroundPanY: normalizeBackgroundPan(rawSection.backgroundPanY),
        imagePath:
          typeof rawSection.imagePath === 'string' && rawSection.imagePath
            ? rawSection.imagePath
            : null
      };
    })
    .filter((section): section is RenderSectionInput => Boolean(section));
}

export function assertFilePath(filePath: string | null, label: string): asserts filePath is string {
  if (typeof filePath !== 'string' || !filePath.trim()) {
    throw new Error(`Missing ${label} path`);
  }
  if (!fs.existsSync(filePath)) {
    throw new Error(`${label} file not found: ${filePath}`);
  }
}

function buildExportAudioLabel(exportAudioPreset: ExportAudioPreset): string {
  if (exportAudioPreset !== EXPORT_AUDIO_PRESET_COMPRESSED) {
    return 'audio_out';
  }

  // Keep the first preset conservative so dialog remains natural while peaks get leveled.
  return 'audio_final';
}

export function buildCameraTrimFilter(
  cameraIdx: number,
  section: RenderSectionInput,
  targetFps: number,
  index: number,
  cameraSyncOffsetMs: number
): string {
  const start = Number(section.sourceStart);
  const end = Number(section.sourceEnd);
  const duration = end - start;
  const offsetSec = normalizeCameraSyncOffsetMs(cameraSyncOffsetMs) / 1000;
  const label = `[cv${index}]`;

  if (!Number.isFinite(offsetSec) || Math.abs(offsetSec) < 0.0005) {
    return `[${cameraIdx}:v]trim=start=${start.toFixed(3)}:end=${end.toFixed(3)},setpts=PTS-STARTPTS,fps=fps=${targetFps}:round=near,trim=duration=${duration.toFixed(3)},setpts=PTS-STARTPTS${label}`;
  }

  const sampleStart = Math.max(0, start + offsetSec);
  const unclampedSampleEnd = Math.max(0, end + offsetSec);
  const sampleEnd = Math.max(sampleStart + 0.001, unclampedSampleEnd);
  const startPad = Math.max(0, -offsetSec);
  const stopPad = Math.max(0, offsetSec);

  return `[${cameraIdx}:v]trim=start=${sampleStart.toFixed(3)}:end=${sampleEnd.toFixed(3)},setpts=PTS-STARTPTS,fps=fps=${targetFps}:round=near,tpad=start_mode=clone:start_duration=${startPad.toFixed(3)}:stop_mode=clone:stop_duration=${stopPad.toFixed(3)},trim=duration=${duration.toFixed(3)},setpts=PTS-STARTPTS${label}`;
}

export function buildAudioTrimFilter(
  screenIdx: number,
  cameraIdx: number,
  screenHasAudio: boolean,
  cameraHasAudio: boolean,
  sourceStart: number,
  sourceEnd: number,
  cameraSyncOffsetMs: number,
  index: number
): string {
  const label = `[sa${index}]`;

  if (screenHasAudio) {
    return `[${screenIdx}:a]atrim=start=${sourceStart.toFixed(3)}:end=${sourceEnd.toFixed(3)},asetpts=PTS-STARTPTS${label}`;
  }

  if (cameraIdx >= 0 && cameraHasAudio) {
    const offsetSec = normalizeCameraSyncOffsetMs(cameraSyncOffsetMs) / 1000;
    const audioStart = Math.max(0, sourceStart + offsetSec);
    const audioEnd = Math.max(audioStart + 0.001, sourceEnd + offsetSec);
    return `[${cameraIdx}:a]atrim=start=${audioStart.toFixed(3)}:end=${audioEnd.toFixed(3)},asetpts=PTS-STARTPTS${label}`;
  }

  const duration = (sourceEnd - sourceStart).toFixed(3);
  return `anullsrc=channel_layout=stereo:sample_rate=48000,atrim=duration=${duration},asetpts=PTS-STARTPTS${label}`;
}

function buildInputPlan(
  sections: RenderSectionInput[],
  takeMap: Map<string, { screenPath: string | null; cameraPath: string | null }>,
  hasCamera: boolean
) {
  const fpsProbePaths = new Set<string>();
  const sectionInputs: Array<{ screenIdx: number; cameraIdx: number; imageIdx: number }> = [];
  const args = ['-progress', 'pipe:1', '-nostats'];
  const takeInputs = new Map<string, { screenIdx: number; cameraIdx: number }>();
  let inputIndex = 0;

  for (const section of sections) {
    const takeId = section.takeId;
    if (!takeId) throw new Error('Section is missing takeId');
    const take = takeMap.get(takeId);
    if (!take) throw new Error(`Take ${takeId} not found`);

    let inputPlan = takeInputs.get(takeId);
    if (!inputPlan) {
      assertFilePath(take.screenPath, 'Screen');
      args.push('-i', take.screenPath);
      fpsProbePaths.add(take.screenPath);

      const screenIdx = inputIndex;
      inputIndex += 1;

      let cameraIdx = -1;
      if (hasCamera && take.cameraPath) {
        assertFilePath(take.cameraPath, 'Camera');
        args.push('-i', take.cameraPath);
        fpsProbePaths.add(take.cameraPath);
        cameraIdx = inputIndex;
        inputIndex += 1;
      }

      inputPlan = { screenIdx, cameraIdx };
      takeInputs.set(takeId, inputPlan);
    }

    let imageIdx = -1;
    if (section.imagePath) {
      assertFilePath(section.imagePath, 'Image');
      const duration = (section.sourceEnd - section.sourceStart).toFixed(3);
      args.push('-loop', '1', '-framerate', '30', '-t', duration, '-i', section.imagePath);
      imageIdx = inputIndex;
      inputIndex += 1;
    }

    sectionInputs.push({ ...inputPlan, imageIdx });
  }

  return {
    args,
    fpsProbePaths,
    sectionInputs
  };
}

function buildOutputArgs(
  targetFps: number,
  outputPath: string,
  exportVideoPreset: ExportVideoPreset
): string[] {
  const config = getRenderVideoConfig(exportVideoPreset);
  return [
    '-r',
    String(targetFps),
    '-fps_mode',
    'cfr',
    '-c:v',
    'libx264',
    '-crf',
    config.crf,
    '-preset',
    config.preset,
    '-g',
    String(targetFps * 2),
    '-pix_fmt',
    config.pixelFormat,
    '-c:a',
    'aac',
    '-b:a',
    config.audioBitrate,
    '-y',
    outputPath
  ];
}

function getTotalDurationSec(sections: RenderSectionInput[]): number {
  return sections.reduce(
    (total, section) => total + Math.max(0, section.sourceEnd - section.sourceStart),
    0
  );
}

function assertOverlayFilterSize(filter: string): void {
  if (filter.length <= MAX_OVERLAY_FILTER_LENGTH) return;
  throw new Error(
    'Render filter is too complex for ffmpeg. Reduce camera layout changes and try again.'
  );
}

function buildRenderProgressUpdate(
  progress: FfmpegProgress | null,
  totalDurationSec: number
): RenderProgressUpdate | null {
  if (!progress || typeof progress !== 'object') return null;

  const outTimeSec = Number(progress.outTimeSec);
  const hasOutTime = Number.isFinite(outTimeSec) && outTimeSec >= 0;
  const clampedPercent =
    hasOutTime && totalDurationSec > 0
      ? Math.max(0, Math.min(1, outTimeSec / totalDurationSec))
      : null;

  if (progress.status === 'end') {
    return {
      phase: 'finalizing',
      percent: 1,
      status: 'Finalizing export...',
      outTimeSec: hasOutTime ? outTimeSec : totalDurationSec,
      durationSec: totalDurationSec,
      frame: progress.frame ?? null,
      speed: progress.speed ?? null
    };
  }

  return {
    phase: 'rendering',
    percent: clampedPercent,
    status:
      clampedPercent === null ? 'Rendering...' : `Rendering ${Math.round(clampedPercent * 100)}%`,
    outTimeSec: hasOutTime ? outTimeSec : null,
    durationSec: totalDurationSec,
    frame: progress.frame ?? null,
    speed: progress.speed ?? null
  };
}

export async function renderComposite(
  opts: RenderCompositeOptions = {},
  deps: RenderCompositeDeps = {}
): Promise<string> {
  const takes = Array.isArray(opts.takes) ? opts.takes : [];
  const sections = normalizeSectionInput(opts.sections);
  const keyframes = Array.isArray(opts.keyframes) ? opts.keyframes : [];
  const pipSize = Number.isFinite(Number(opts.pipSize)) ? Number(opts.pipSize) : 422;
  const screenFitMode = opts.screenFitMode === 'fit' ? 'fit' : 'fill';
  const exportAudioPreset = normalizeExportAudioPreset(opts.exportAudioPreset);
  const exportVideoPreset = normalizeExportVideoPreset(opts.exportVideoPreset);
  const cameraSyncOffsetMs = normalizeCameraSyncOffsetMs(opts.cameraSyncOffsetMs);
  const sourceWidth = Number.isFinite(Number(opts.sourceWidth)) ? Number(opts.sourceWidth) : 1920;
  const sourceHeight = Number.isFinite(Number(opts.sourceHeight))
    ? Number(opts.sourceHeight)
    : 1080;
  const outputFolder = typeof opts.outputFolder === 'string' ? opts.outputFolder : '';

  const probeFps = deps.probeVideoFpsWithFfmpeg || probeVideoFpsWithFfmpeg;
  const runFfmpegProcess = deps.runFfmpeg || runFfmpeg;
  const ffmpegPath = deps.ffmpegPath ?? ffmpegStatic;
  const now = typeof deps.now === 'function' ? deps.now : Date.now;
  const onProgress = typeof deps.onProgress === 'function' ? deps.onProgress : null;

  if (!outputFolder) throw new Error('Missing output folder');
  if (sections.length === 0) throw new Error('No sections to render');

  ensureDirectory(outputFolder);

  if (!ffmpegPath) throw new Error('ffmpeg-static is unavailable on this platform');

  const outputPath = path.join(outputFolder, `recording-${now()}-edited.mp4`);
  const { canvasW, canvasH } = deriveRenderCanvasSize(sourceWidth, sourceHeight, exportVideoPreset);

  const takeMap = new Map<string, { screenPath: string | null; cameraPath: string | null }>();
  for (const take of takes) {
    if (!take || typeof take.id !== 'string' || !take.id) continue;
    takeMap.set(take.id, {
      screenPath: take.screenPath,
      cameraPath: take.cameraPath
    });
  }

  const hasCamera = keyframes.some((keyframe) => keyframe.pipVisible || keyframe.cameraFullscreen);
  const { args, fpsProbePaths, sectionInputs } = buildInputPlan(sections, takeMap, hasCamera);
  const totalDurationSec = getTotalDurationSec(sections);

  const fpsProbeResults = await Promise.all(
    Array.from(fpsProbePaths).map(async (filePath) => {
      const result = await probeFps(ffmpegPath, filePath);
      return { filePath, ...result };
    })
  );

  const targetFps = chooseRenderFps(
    fpsProbeResults.map((result) => result.fps),
    hasCamera
  );

  const fileHasAudio = new Map<string, boolean>();
  for (const result of fpsProbeResults) {
    fileHasAudio.set(result.filePath, result.hasAudio);
  }

  console.log(
    '[render-composite] FPS selection:',
    fpsProbeResults.map((result) => ({
      file: path.basename(result.filePath),
      fps: result.fps ? Number(result.fps.toFixed(3)) : null,
      hasAudio: result.hasAudio
    })),
    'targetFps=',
    targetFps
  );

  const hasImageSections = sections.some((s) => s.imagePath);
  const filterParts: string[] = [];
  for (let index = 0; index < sections.length; index += 1) {
    const section = sections[index];
    const { screenIdx, imageIdx } = sectionInputs[index];
    const start = section.sourceStart.toFixed(3);
    const end = section.sourceEnd.toFixed(3);

    const sectionDuration = (section.sourceEnd - section.sourceStart).toFixed(3);
    // Each video section gets fps-normalized and duration-clamped so its
    // duration exactly matches the audio trim.  Without this, VFR sections
    // are slightly shorter than the audio and the mismatch accumulates
    // across concat segments, causing progressive A/V drift.
    const cfrClamp = `,fps=fps=${targetFps}:round=near,trim=duration=${sectionDuration},setpts=PTS-STARTPTS`;
    if (imageIdx >= 0) {
      const imageScale =
        screenFitMode === 'fill'
          ? `scale=${canvasW}:${canvasH}:flags=lanczos:force_original_aspect_ratio=increase,crop=${canvasW}:${canvasH}`
          : `scale=${canvasW}:${canvasH}:flags=lanczos:force_original_aspect_ratio=decrease,pad=${canvasW}:${canvasH}:(ow-iw)/2:(oh-ih)/2:black`;
      filterParts.push(
        `[${imageIdx}:v]${imageScale},format=yuv420p,setpts=PTS-STARTPTS,setsar=1[sv${index}]`
      );
    } else if (hasImageSections) {
      // Pre-scale video to canvas size so concat inputs match image sections
      filterParts.push(
        `[${screenIdx}:v]trim=start=${start}:end=${end},setpts=PTS-STARTPTS,scale=${canvasW}:${canvasH}:flags=lanczos:force_original_aspect_ratio=increase,crop=${canvasW}:${canvasH}${cfrClamp},setsar=1[sv${index}]`
      );
    } else {
      filterParts.push(
        `[${screenIdx}:v]trim=start=${start}:end=${end},setpts=PTS-STARTPTS${cfrClamp},setsar=1[sv${index}]`
      );
    }
    const take = takeMap.get(section.takeId!);
    const screenHasAudio = take?.screenPath
      ? (fileHasAudio.get(take.screenPath) ?? false)
      : false;
    const cameraHasAudio =
      sectionInputs[index].cameraIdx >= 0 && take?.cameraPath
        ? (fileHasAudio.get(take.cameraPath) ?? false)
        : false;
    filterParts.push(
      buildAudioTrimFilter(
        screenIdx,
        sectionInputs[index].cameraIdx,
        screenHasAudio,
        cameraHasAudio,
        section.sourceStart,
        section.sourceEnd,
        cameraSyncOffsetMs,
        index
      )
    );
  }

  const screenLabels = sections.map((_, index) => `[sv${index}][sa${index}]`).join('');
  filterParts.push(`${screenLabels}concat=n=${sections.length}:v=1:a=1[screen_raw][audio_out]`);
  // Normalize VFR screen video to constant frame rate right after concat.
  // VFR sources (WebM from MediaRecorder) cause trim boundaries to misalign
  // with audio, and the per-section drift accumulates across concat segments.
  // Applying fps here fills frame-timing gaps so video duration matches audio.
  filterParts.push(`[screen_raw]fps=fps=${targetFps}:round=near[screen_cfr]`);
  const exportAudioLabel = buildExportAudioLabel(exportAudioPreset);
  if (exportAudioLabel === 'audio_final') {
    filterParts.push(
      '[audio_out]acompressor=threshold=0.125:ratio=3:attack=20:release=250:makeup=1.5[audio_final]'
    );
  }

  if (hasCamera) {
    for (let index = 0; index < sections.length; index += 1) {
      const section = sections[index];
      const { cameraIdx } = sectionInputs[index];
      const duration = (section.sourceEnd - section.sourceStart).toFixed(3);
      if (cameraIdx >= 0) {
        filterParts.push(
          buildCameraTrimFilter(cameraIdx, section, targetFps, index, cameraSyncOffsetMs)
        );
      } else {
        filterParts.push(`color=black:s=${canvasW}x${canvasH}:d=${duration}[cv${index}]`);
      }
    }

    const cameraLabels = sections.map((_, index) => `[cv${index}]`).join('');
    filterParts.push(`${cameraLabels}concat=n=${sections.length}:v=1:a=0[camera_raw]`);
    filterParts.push(`[camera_raw]fps=fps=${targetFps}:round=near[camera_cfr]`);
    const overlayFilter = buildFilterComplex(
      keyframes,
      pipSize,
      screenFitMode,
      sourceWidth,
      sourceHeight,
      canvasW,
      canvasH,
      targetFps
    );
    assertOverlayFilterSize(overlayFilter);
    const adaptedOverlay = overlayFilter
      .replace(/\[0:v\]/g, '[screen_cfr]')
      .replace(/\[1:v\]/g, '[camera_cfr]');
    filterParts.push(adaptedOverlay);
  } else {
    const screenOnlyFilter = buildScreenFilter(
      keyframes,
      screenFitMode,
      sourceWidth,
      sourceHeight,
      canvasW,
      canvasH,
      '[out]',
      targetFps
    ).replace(/\[0:v\]/g, '[screen_cfr]');
    filterParts.push(screenOnlyFilter);
  }

  filterParts.push(`[out]fps=fps=${targetFps}:round=near[out_cfr]`);
  args.push(
    '-filter_complex',
    filterParts.join(';'),
    '-map',
    '[out_cfr]',
    '-map',
    `[${exportAudioLabel}]`
  );
  args.push(...buildOutputArgs(targetFps, outputPath, exportVideoPreset));

  console.log('ffmpeg args:', args.join(' '));

  if (onProgress) {
    onProgress({
      phase: 'starting',
      percent: 0,
      status: 'Preparing render...',
      durationSec: totalDurationSec
    });
  }

  try {
    await runFfmpegProcess({
      ffmpegPath,
      args,
      onProgress: (progress) => {
        if (!onProgress) return;
        const update = buildRenderProgressUpdate(progress, totalDurationSec);
        if (update) onProgress(update);
      }
    });
    return outputPath;
  } catch (error) {
    const message = error instanceof Error ? error.message : error;
    console.error('ffmpeg stderr:', message);
    throw error;
  }
}
