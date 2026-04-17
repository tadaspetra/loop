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
  // Per-recorder delay (ms, non-negative) between this take's anchor
  // (earliest) recorder first data chunk and this specific file's first data
  // chunk. Applied as a trim-window shift per source so the same section
  // window in the export refers to the same real-world moment on every file.
  screenStartOffsetMs?: number;
  cameraStartOffsetMs?: number;
  audioStartOffsetMs?: number;
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
  // Optional explicit output path. When set, the given path is used as-is
  // (no recording-${now}-edited.mp4 auto-naming). Useful for deterministic
  // paths like the background preview render that is keyed by timeline hash.
  outputPath?: string;
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

/**
 * Compute a shifted trim window plus the amount of start/stop padding
 * required to hit the desired output duration. Positive `shiftSec` means
 * sample the source later (start/end pushed forward); negative means sample
 * earlier, which may require padding the clipped prefix with clones/silence.
 *
 * The output invariants:
 * - The trim window is always within the source's valid time (>= 0).
 * - `startPad + (sampleEnd - sampleStart) + stopPad == sectionEnd - sectionStart`,
 *   so a downstream `trim=duration=${sectionEnd - sectionStart}` always yields
 *   the exact section length even when the source was short of the window.
 */
export interface ShiftedTrimWindow {
  sampleStart: number;
  sampleEnd: number;
  startPad: number;
  stopPad: number;
  duration: number;
}

export function computeShiftedTrimWindow(
  sectionStart: number,
  sectionEnd: number,
  shiftSec: number
): ShiftedTrimWindow {
  const duration = Math.max(0, sectionEnd - sectionStart);
  const shift = Number.isFinite(shiftSec) ? shiftSec : 0;
  const effectiveStart = sectionStart + shift;
  const effectiveEnd = sectionEnd + shift;
  const sampleStart = Math.max(0, effectiveStart);
  const sampleEnd = Math.max(sampleStart + 0.001, Math.max(0, effectiveEnd));
  const startPad = Math.max(0, -effectiveStart);
  // stopPad keeps the downstream `trim=duration` honest when the source
  // doesn't extend far enough into the shifted window (e.g. positive shift
  // past file end). For a shift ≥ 0, the potential shortfall is exactly
  // `shift` seconds; for a negative shift, no stop padding is needed.
  const stopPad = Math.max(0, shift);
  return { sampleStart, sampleEnd, startPad, stopPad, duration };
}

function hasMeaningfulShift(shiftSec: number): boolean {
  return Number.isFinite(shiftSec) && Math.abs(shiftSec) >= 0.0005;
}

// Safety pad added to the end of every trimmed video section so the final
// `trim=duration=D` can always hit the exact nominal section length. This
// absorbs:
//
// 1. VFR frame-quantization loss — a naive `trim=X:Y` on a 29.25fps source
//    can produce a stream whose actual last-frame PTS is a frame or two
//    shy of Y. Audio `atrim=X:Y` is sample-accurate (no such loss), so
//    without this pad the per-section video duration is <= audio duration
//    and the mismatch accumulates into a visible audio-leads-video drift
//    over multi-section exports.
// 2. Future-shift shortfall when `shiftSec > 0` runs off the end of the
//    source file; the `max(0, shiftSec)` term below covers that case on
//    top of the baseline safety pad.
const VIDEO_TRIM_SAFETY_STOP_PAD_SEC = 0.25;

function buildShiftedVideoTrim(
  inputLabel: string,
  sectionStart: number,
  sectionEnd: number,
  shiftSec: number,
  outputLabel: string,
  tailFilter: string
): string {
  const suffix = tailFilter ? `,${tailFilter}` : '';
  const shift = Number.isFinite(shiftSec) ? shiftSec : 0;
  const meaningfulShift = hasMeaningfulShift(shift);
  const baseWindow = meaningfulShift
    ? computeShiftedTrimWindow(sectionStart, sectionEnd, shift)
    : {
        sampleStart: sectionStart,
        sampleEnd: sectionEnd,
        startPad: 0,
        stopPad: 0,
        duration: Math.max(0, sectionEnd - sectionStart)
      };
  const stopPad = baseWindow.stopPad + VIDEO_TRIM_SAFETY_STOP_PAD_SEC;
  return `${inputLabel}trim=start=${baseWindow.sampleStart.toFixed(3)}:end=${baseWindow.sampleEnd.toFixed(3)},setpts=PTS-STARTPTS,tpad=start_mode=clone:start_duration=${baseWindow.startPad.toFixed(3)}:stop_mode=clone:stop_duration=${stopPad.toFixed(3)},trim=duration=${baseWindow.duration.toFixed(3)},setpts=PTS-STARTPTS${suffix}${outputLabel}`;
}

// Mirror of `VIDEO_TRIM_SAFETY_STOP_PAD_SEC` for audio: every section's
// `atrim` is followed by a small `apad` + final-`atrim=duration` cap so the
// per-section audio length is exactly the section's nominal duration. Audio
// `atrim` is normally sample-accurate, but if a recording was cut short
// (e.g. camera file ends a few frames before screen), the tail section's
// audio would otherwise be shorter than its video, which would propagate
// through `concat` into multi-section audio/video drift.
const AUDIO_TRIM_SAFETY_STOP_PAD_SEC = 0.25;

function buildShiftedAudioTrim(
  inputLabel: string,
  sectionStart: number,
  sectionEnd: number,
  shiftSec: number,
  outputLabel: string
): string {
  const shift = Number.isFinite(shiftSec) ? shiftSec : 0;
  const meaningfulShift = hasMeaningfulShift(shift);
  const baseWindow = meaningfulShift
    ? computeShiftedTrimWindow(sectionStart, sectionEnd, shift)
    : {
        sampleStart: sectionStart,
        sampleEnd: sectionEnd,
        startPad: 0,
        stopPad: 0,
        duration: Math.max(0, sectionEnd - sectionStart)
      };
  const filters: string[] = [
    `atrim=start=${baseWindow.sampleStart.toFixed(3)}:end=${baseWindow.sampleEnd.toFixed(3)}`,
    'asetpts=PTS-STARTPTS'
  ];
  if (baseWindow.startPad > 0) {
    const startPadMs = Math.round(baseWindow.startPad * 1000);
    filters.push(`adelay=${startPadMs}|${startPadMs}`);
  }
  // Always `apad` so the downstream `atrim=duration` can guarantee the
  // section's exact length even if the shifted window (or the source itself)
  // ran short of the nominal end.
  const stopPad = baseWindow.stopPad + AUDIO_TRIM_SAFETY_STOP_PAD_SEC;
  filters.push(`apad=pad_dur=${stopPad.toFixed(3)}`);
  filters.push(`atrim=duration=${baseWindow.duration.toFixed(3)}`);
  filters.push('asetpts=PTS-STARTPTS');
  return `${inputLabel}${filters.join(',')}${outputLabel}`;
}

/**
 * Returns the ffmpeg filter chain that trims the camera input for a single
 * section, shifting the source window by the combined auto-measured recorder
 * start skew and the user's manual `cameraSyncOffsetMs` fine-tune.
 *
 * Sign conventions:
 * - `cameraStartOffsetMs` (auto): how much later than the anchor recorder the
 *   camera produced its first chunk. Positive means camera content is delayed
 *   relative to the anchor, so we sample it EARLIER to re-align.
 * - `cameraSyncOffsetMs` (user): positive means "advance the camera"
 *   (= sample later in the camera file), matching the editor-playback
 *   semantics of `resolveCameraPlaybackTargetTime(screenTime, offsetMs)`.
 *
 * Effective shift = userOffsetMs/1000 - cameraStartOffsetMs/1000.
 */
export function buildCameraTrimFilter(
  cameraIdx: number,
  section: RenderSectionInput,
  _targetFps: number,
  index: number,
  cameraSyncOffsetMs: number,
  cameraStartOffsetMs = 0
): string {
  const userOffsetSec = normalizeCameraSyncOffsetMs(cameraSyncOffsetMs) / 1000;
  const autoOffsetSec = Math.max(0, Number(cameraStartOffsetMs) || 0) / 1000;
  const shiftSec = userOffsetSec - autoOffsetSec;
  return buildShiftedVideoTrim(
    `[${cameraIdx}:v]`,
    Number(section.sourceStart),
    Number(section.sourceEnd),
    shiftSec,
    `[cv${index}]`,
    ''
  );
}

interface TakeInputPlan {
  screenIdx: number;
  cameraIdx: number;
  audioIdx: number;
  audioSource: AudioSource;
  hasSystemAudio: boolean;
  screenStartOffsetMs: number;
  cameraStartOffsetMs: number;
  audioStartOffsetMs: number;
}

interface TakePlanEntry {
  screenPath: string | null;
  cameraPath: string | null;
  audioPath: string | null;
  audioSource: AudioSource;
  hasSystemAudio: boolean;
  screenStartOffsetMs: number;
  cameraStartOffsetMs: number;
  audioStartOffsetMs: number;
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
        hasSystemAudio: take.hasSystemAudio,
        screenStartOffsetMs: take.screenStartOffsetMs,
        cameraStartOffsetMs: take.cameraStartOffsetMs,
        audioStartOffsetMs: take.audioStartOffsetMs
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

  const explicitOutputPath = typeof opts.outputPath === 'string' ? opts.outputPath : '';
  if (!outputFolder && !explicitOutputPath) throw new Error('Missing output folder');
  if (sections.length === 0) throw new Error('No sections to render');

  const targetFolder = explicitOutputPath ? path.dirname(explicitOutputPath) : outputFolder;
  ensureDirectory(targetFolder);

  if (!ffmpegPath) throw new Error('ffmpeg-static is unavailable on this platform');

  const outputPath = explicitOutputPath
    ? explicitOutputPath
    : path.join(outputFolder, `recording-${now()}-edited.mp4`);
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
    const screenStartOffsetMs = Math.max(0, Number(take.screenStartOffsetMs) || 0);
    const cameraStartOffsetMs = Math.max(0, Number(take.cameraStartOffsetMs) || 0);
    const audioStartOffsetMs = Math.max(0, Number(take.audioStartOffsetMs) || 0);
    takeMap.set(take.id, {
      screenPath: take.screenPath,
      cameraPath: take.cameraPath,
      audioPath: take.audioPath ?? null,
      audioSource,
      // If the screen file's system audio track also carries the mic (legacy
      // takes where audioSource === 'screen'), we already pull audio from
      // screen — there's no second stream to mix. Only mark hasSystemAudio
      // as an additional track when the mic lives elsewhere.
      hasSystemAudio: take.hasSystemAudio === true && audioSource !== 'screen',
      screenStartOffsetMs,
      cameraStartOffsetMs,
      audioStartOffsetMs
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
    const {
      screenIdx,
      cameraIdx,
      audioIdx,
      audioSource,
      imageIdx,
      screenStartOffsetMs,
      cameraStartOffsetMs,
      audioStartOffsetMs
    } = sectionInputs[index];
    const sectionStart = Number(section.sourceStart);
    const sectionEnd = Number(section.sourceEnd);

    // Screen video trim — for ordinary video sections we shift the source
    // window by (-screenStartOffsetMs) so the trim refers to the same
    // real-world moment as other sources in this take; fps normalization
    // happens once, after the screen concat, per the AGENTS.md guidance that
    // per-section fps rounding can drift trimmed durations.
    const screenShiftSec = -screenStartOffsetMs / 1000;
    if (imageIdx >= 0) {
      const imageScale =
        screenFitMode === 'fill'
          ? `scale=${canvasW}:${canvasH}:flags=lanczos:force_original_aspect_ratio=increase,crop=${canvasW}:${canvasH}`
          : `scale=${canvasW}:${canvasH}:flags=lanczos:force_original_aspect_ratio=decrease,pad=${canvasW}:${canvasH}:(ow-iw)/2:(oh-ih)/2:black`;
      filterParts.push(
        `[${imageIdx}:v]${imageScale},format=yuv420p,setpts=PTS-STARTPTS,setsar=1[sv${index}]`
      );
    } else if (hasImageSections) {
      const tail = `scale=${canvasW}:${canvasH}:flags=lanczos:force_original_aspect_ratio=increase,crop=${canvasW}:${canvasH},setsar=1`;
      filterParts.push(
        buildShiftedVideoTrim(
          `[${screenIdx}:v]`,
          sectionStart,
          sectionEnd,
          screenShiftSec,
          `[sv${index}]`,
          tail
        )
      );
    } else {
      filterParts.push(
        buildShiftedVideoTrim(
          `[${screenIdx}:v]`,
          sectionStart,
          sectionEnd,
          screenShiftSec,
          `[sv${index}]`,
          'setsar=1'
        )
      );
    }
    // Pull audio from whichever input actually owns the mic for this take.
    // Legacy takes report 'screen' and behave exactly like before; new takes
    // with a camera report 'camera'; screen-only takes with a mic report
    // 'external' and have a dedicated audio input.
    let micInputIdx = screenIdx;
    let micStartOffsetMs = screenStartOffsetMs;
    if (audioSource === 'camera' && cameraIdx >= 0) {
      micInputIdx = cameraIdx;
      micStartOffsetMs = cameraStartOffsetMs;
    } else if (audioSource === 'external' && audioIdx >= 0) {
      micInputIdx = audioIdx;
      micStartOffsetMs = audioStartOffsetMs;
    }
    const micShiftSec = -micStartOffsetMs / 1000;
    const systemAudioShiftSec = -screenStartOffsetMs / 1000;
    const { hasSystemAudio } = sectionInputs[index];
    if (hasSystemAudio) {
      // Mix mic + system audio so viewers hear both the presenter and the
      // system/desktop sound at the same time. amix normalizes levels by
      // default (1/n scaling); we keep that to avoid clipping.
      filterParts.push(
        buildShiftedAudioTrim(
          `[${micInputIdx}:a]`,
          sectionStart,
          sectionEnd,
          micShiftSec,
          `[sa${index}m]`
        )
      );
      filterParts.push(
        buildShiftedAudioTrim(
          `[${screenIdx}:a]`,
          sectionStart,
          sectionEnd,
          systemAudioShiftSec,
          `[sa${index}s]`
        )
      );
      filterParts.push(
        `[sa${index}m][sa${index}s]amix=inputs=2:duration=longest:dropout_transition=0[sa${index}]`
      );
    } else {
      filterParts.push(
        buildShiftedAudioTrim(
          `[${micInputIdx}:a]`,
          sectionStart,
          sectionEnd,
          micShiftSec,
          `[sa${index}]`
        )
      );
    }
  }

  const screenLabels = sections.map((_, index) => `[sv${index}][sa${index}]`).join('');
  // concat produces VFR output; normalize to a single post-concat fps so
  // per-section trimmed durations stay matched instead of drifting by a few
  // frames per section when the source is VFR (see AGENTS.md learned fact).
  filterParts.push(
    `${screenLabels}concat=n=${sections.length}:v=1:a=1[screen_concat][audio_out]`
  );
  filterParts.push(`[screen_concat]fps=${targetFps},setsar=1[screen_raw]`);
  const exportAudioLabel = buildExportAudioLabel(exportAudioPreset);
  if (exportAudioLabel === 'audio_final') {
    filterParts.push(
      '[audio_out]acompressor=threshold=0.125:ratio=3:attack=20:release=250:makeup=1.5[audio_final]'
    );
  }

  if (hasCamera) {
    for (let index = 0; index < sections.length; index += 1) {
      const section = sections[index];
      const { cameraIdx, cameraStartOffsetMs } = sectionInputs[index];
      const duration = (Number(section.sourceEnd) - Number(section.sourceStart)).toFixed(3);
      if (cameraIdx >= 0) {
        filterParts.push(
          buildCameraTrimFilter(
            cameraIdx,
            section,
            targetFps,
            index,
            cameraSyncOffsetMs,
            cameraStartOffsetMs
          )
        );
      } else {
        filterParts.push(`color=black:s=${canvasW}x${canvasH}:d=${duration}[cv${index}]`);
      }
    }

    const cameraLabels = sections.map((_, index) => `[cv${index}]`).join('');
    filterParts.push(`${cameraLabels}concat=n=${sections.length}:v=1:a=0[camera_concat]`);
    filterParts.push(`[camera_concat]fps=${targetFps},setsar=1[camera_raw]`);
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
