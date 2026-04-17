import path from 'node:path';

import ffmpegStatic from 'ffmpeg-static';

import { ensureDirectory, fs } from '../infra/file-system';
import {
  EXPORT_AUDIO_PRESET_COMPRESSED,
  normalizeAudioSource,
  normalizeBackgroundPan,
  normalizeBackgroundZoom,
  normalizeCameraSyncOffsetMs,
  normalizeExportAudioPreset,
  normalizeExportVideoPreset,
  type AudioSource,
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
  audioPath?: string | null;
  audioSource?: AudioSource | null;
  // True when the screen webm contains a captured system-audio track. Mixed
  // with the mic track (when present) via ffmpeg amix during export.
  hasSystemAudio?: boolean;
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
  signal?: AbortSignal;
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
    return `[${cameraIdx}:v]trim=start=${start.toFixed(3)}:end=${end.toFixed(3)},setpts=PTS-STARTPTS,fps=${targetFps},trim=duration=${duration.toFixed(3)},setpts=PTS-STARTPTS${label}`;
  }

  const sampleStart = Math.max(0, start + offsetSec);
  const unclampedSampleEnd = Math.max(0, end + offsetSec);
  const sampleEnd = Math.max(sampleStart + 0.001, unclampedSampleEnd);
  const startPad = Math.max(0, -offsetSec);
  const stopPad = Math.max(0, offsetSec);

  return `[${cameraIdx}:v]trim=start=${sampleStart.toFixed(3)}:end=${sampleEnd.toFixed(3)},setpts=PTS-STARTPTS,fps=${targetFps},tpad=start_mode=clone:start_duration=${startPad.toFixed(3)}:stop_mode=clone:stop_duration=${stopPad.toFixed(3)},trim=duration=${duration.toFixed(3)},setpts=PTS-STARTPTS${label}`;
}

interface TakeInputPlan {
  screenIdx: number;
  cameraIdx: number;
  audioIdx: number;
  audioSource: AudioSource;
  hasSystemAudio: boolean;
}

interface TakePlanEntry {
  screenPath: string | null;
  cameraPath: string | null;
  audioPath: string | null;
  audioSource: AudioSource;
  hasSystemAudio: boolean;
}

function buildInputPlan(
  sections: RenderSectionInput[],
  takeMap: Map<string, TakePlanEntry>,
  hasCamera: boolean
) {
  const fpsProbePaths = new Set<string>();
  const sectionInputs: Array<TakeInputPlan & { imageIdx: number }> = [];
  const args = ['-progress', 'pipe:1', '-nostats'];
  const takeInputs = new Map<string, TakeInputPlan>();
  let inputIndex = 0;

  for (const section of sections) {
    const takeId = section.takeId;
    if (!takeId) throw new Error('Section is missing takeId');
    const take = takeMap.get(takeId);
    if (!take) throw new Error(`Take ${takeId} not found`);

    let inputPlan = takeInputs.get(takeId);
    if (!inputPlan) {
      assertFilePath(take.screenPath, 'Screen');
      args.push('-fflags', '+genpts', '-i', take.screenPath);
      fpsProbePaths.add(take.screenPath);

      const screenIdx = inputIndex;
      inputIndex += 1;

      // Camera input is added whenever the camera file is referenced for
      // video (hasCamera) OR when the camera file owns this take's audio
      // track (audioSource='camera'). Otherwise an audio-on-camera recording
      // would lose its mic if the user had no keyframe toggling the PiP on.
      const needsCameraForVideo = hasCamera && !!take.cameraPath;
      const needsCameraForAudio = take.audioSource === 'camera' && !!take.cameraPath;
      let cameraIdx = -1;
      if (needsCameraForVideo || needsCameraForAudio) {
        assertFilePath(take.cameraPath, 'Camera');
        args.push('-fflags', '+genpts', '-i', take.cameraPath as string);
        fpsProbePaths.add(take.cameraPath as string);
        cameraIdx = inputIndex;
        inputIndex += 1;
      }

      let audioIdx = -1;
      if (take.audioSource === 'external' && take.audioPath) {
        assertFilePath(take.audioPath, 'Audio');
        args.push('-fflags', '+genpts', '-i', take.audioPath);
        audioIdx = inputIndex;
        inputIndex += 1;
      }

      inputPlan = {
        screenIdx,
        cameraIdx,
        audioIdx,
        audioSource: take.audioSource,
        hasSystemAudio: take.hasSystemAudio
      };
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

  const takeMap = new Map<string, TakePlanEntry>();
  for (const take of takes) {
    if (!take || typeof take.id !== 'string' || !take.id) continue;
    // Default missing/invalid audioSource to 'screen' so legacy takes (mic
    // muxed into the screen file) keep exporting correctly after the audio
    // routing change. Older recordings that never captured a mic also fall
    // back to 'screen' here; the ffmpeg filter graph stays uniform because
    // [screenIdx:a] has always been referenced unconditionally.
    const audioSource: AudioSource = normalizeAudioSource(take.audioSource) ?? 'screen';
    takeMap.set(take.id, {
      screenPath: take.screenPath,
      cameraPath: take.cameraPath,
      audioPath: take.audioPath ?? null,
      audioSource,
      // If the screen file's system audio track also carries the mic (legacy
      // takes where audioSource === 'screen'), we already pull audio from
      // screen — there's no second stream to mix. Only mark hasSystemAudio
      // as an additional track when the mic lives elsewhere.
      hasSystemAudio: take.hasSystemAudio === true && audioSource !== 'screen'
    });
  }

  const hasCamera = keyframes.some((keyframe) => keyframe.pipVisible || keyframe.cameraFullscreen);
  const { args, fpsProbePaths, sectionInputs } = buildInputPlan(sections, takeMap, hasCamera);
  const totalDurationSec = getTotalDurationSec(sections);

  const fpsProbeResults = await Promise.all(
    Array.from(fpsProbePaths).map(async (filePath) => ({
      filePath,
      fps: await probeFps(ffmpegPath, filePath)
    }))
  );

  const targetFps = chooseRenderFps(
    fpsProbeResults.map((result) => result.fps),
    hasCamera
  );

  console.log(
    '[render-composite] FPS selection:',
    fpsProbeResults.map((result) => ({
      file: path.basename(result.filePath),
      fps: result.fps ? Number(result.fps.toFixed(3)) : null
    })),
    'targetFps=',
    targetFps
  );

  const hasImageSections = sections.some((s) => s.imagePath);
  const filterParts: string[] = [];
  for (let index = 0; index < sections.length; index += 1) {
    const section = sections[index];
    const { screenIdx, cameraIdx, audioIdx, audioSource, imageIdx } = sectionInputs[index];
    const start = section.sourceStart.toFixed(3);
    const end = section.sourceEnd.toFixed(3);

    const sectionDur = (section.sourceEnd - section.sourceStart).toFixed(3);
    if (imageIdx >= 0) {
      const imageScale =
        screenFitMode === 'fill'
          ? `scale=${canvasW}:${canvasH}:flags=lanczos:force_original_aspect_ratio=increase,crop=${canvasW}:${canvasH}`
          : `scale=${canvasW}:${canvasH}:flags=lanczos:force_original_aspect_ratio=decrease,pad=${canvasW}:${canvasH}:(ow-iw)/2:(oh-ih)/2:black`;
      filterParts.push(
        `[${imageIdx}:v]${imageScale},format=yuv420p,setpts=PTS-STARTPTS,setsar=1[sv${index}]`
      );
    } else if (hasImageSections) {
      filterParts.push(
        `[${screenIdx}:v]trim=start=${start}:end=${end},setpts=PTS-STARTPTS,fps=${targetFps},trim=duration=${sectionDur},setpts=PTS-STARTPTS,scale=${canvasW}:${canvasH}:flags=lanczos:force_original_aspect_ratio=increase,crop=${canvasW}:${canvasH},setsar=1[sv${index}]`
      );
    } else {
      filterParts.push(
        `[${screenIdx}:v]trim=start=${start}:end=${end},setpts=PTS-STARTPTS,fps=${targetFps},trim=duration=${sectionDur},setpts=PTS-STARTPTS,setsar=1[sv${index}]`
      );
    }
    // Pull audio from whichever input actually owns the mic for this take.
    // Legacy takes report 'screen' and behave exactly like before; new takes
    // with a camera report 'camera'; screen-only takes with a mic report
    // 'external' and have a dedicated audio input.
    let micInputIdx = screenIdx;
    if (audioSource === 'camera' && cameraIdx >= 0) {
      micInputIdx = cameraIdx;
    } else if (audioSource === 'external' && audioIdx >= 0) {
      micInputIdx = audioIdx;
    }
    const { hasSystemAudio } = sectionInputs[index];
    if (hasSystemAudio) {
      // Mix mic + system audio so viewers hear both the presenter and the
      // system/desktop sound at the same time. amix normalizes levels by
      // default (1/n scaling); we keep that to avoid clipping.
      filterParts.push(
        `[${micInputIdx}:a]atrim=start=${start}:end=${end},asetpts=PTS-STARTPTS[sa${index}m]`
      );
      filterParts.push(
        `[${screenIdx}:a]atrim=start=${start}:end=${end},asetpts=PTS-STARTPTS[sa${index}s]`
      );
      filterParts.push(
        `[sa${index}m][sa${index}s]amix=inputs=2:duration=longest:dropout_transition=0[sa${index}]`
      );
    } else {
      filterParts.push(
        `[${micInputIdx}:a]atrim=start=${start}:end=${end},asetpts=PTS-STARTPTS[sa${index}]`
      );
    }
  }

  const screenLabels = sections.map((_, index) => `[sv${index}][sa${index}]`).join('');
  filterParts.push(`${screenLabels}concat=n=${sections.length}:v=1:a=1[screen_raw][audio_out]`);
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
      .replace(/\[0:v\]/g, '[screen_raw]')
      .replace(/\[1:v\]/g, '[camera_raw]');
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
    ).replace(/\[0:v\]/g, '[screen_raw]');
    filterParts.push(screenOnlyFilter);
  }

  args.push(
    '-filter_complex',
    filterParts.join(';'),
    '-map',
    '[out]',
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
      signal: deps.signal,
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
