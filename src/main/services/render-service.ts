import path from 'node:path';

import ffmpegStatic from 'ffmpeg-static';

import { ensureDirectory, fs } from '../infra/file-system';
import {
  EXPORT_AUDIO_PRESET_COMPRESSED,
  normalizeBackgroundPan,
  normalizeBackgroundZoom,
  normalizeCameraSyncOffsetMs,
  normalizeExportAudioPreset,
  type ExportAudioPreset,
  type Keyframe,
  type ScreenFitMode,
} from '../../shared/domain/project';
import type { RenderProgressUpdate } from '../../shared/electron-api';
import { chooseRenderFps, probeVideoFpsWithFfmpeg } from './fps-service';
import { runFfmpeg, type FfmpegProgress } from './ffmpeg-runner';
import {
  buildFilterComplex,
  buildScreenFilter,
} from './render-filter-service';

interface RenderSectionInput {
  takeId: string | null;
  sourceStart: number;
  sourceEnd: number;
  backgroundZoom: number;
  backgroundPanX: number;
  backgroundPanY: number;
}

interface RenderTakeInput {
  id: string;
  screenPath: string | null;
  cameraPath: string | null;
}

interface RenderCompositeOptions {
  takes?: RenderTakeInput[];
  sections?: unknown[];
  keyframes?: Keyframe[];
  pipSize?: number;
  screenFitMode?: ScreenFitMode;
  exportAudioPreset?: ExportAudioPreset;
  cameraSyncOffsetMs?: number;
  sourceWidth?: number;
  sourceHeight?: number;
  outputFolder?: string;
}

interface RenderCompositeDeps {
  probeVideoFpsWithFfmpeg?: typeof probeVideoFpsWithFfmpeg;
  runFfmpeg?: typeof runFfmpeg;
  ffmpegPath?: string | null;
  now?: () => number;
  onProgress?: (progress: RenderProgressUpdate) => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function normalizeSectionInput(rawSections: unknown): RenderSectionInput[] {
  const sections = Array.isArray(rawSections) ? rawSections : [];
  return sections
    .map((rawSection) => {
      if (!isRecord(rawSection)) return null;
      const sourceStart = Number(rawSection.sourceStart);
      const sourceEnd = Number(rawSection.sourceEnd);
      if (!Number.isFinite(sourceStart) || !Number.isFinite(sourceEnd) || sourceEnd <= sourceStart) {
        return null;
      }
      return {
        takeId:
          typeof rawSection.takeId === 'string' ? rawSection.takeId : null,
        sourceStart,
        sourceEnd,
        backgroundZoom: normalizeBackgroundZoom(rawSection.backgroundZoom),
        backgroundPanX: normalizeBackgroundPan(rawSection.backgroundPanX),
        backgroundPanY: normalizeBackgroundPan(rawSection.backgroundPanY),
      };
    })
    .filter((section): section is RenderSectionInput => Boolean(section));
}

export function assertFilePath(
  filePath: string | null,
  label: string,
): asserts filePath is string {
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
  cameraSyncOffsetMs: number,
): string {
  const start = Number(section.sourceStart);
  const end = Number(section.sourceEnd);
  const duration = end - start;
  const offsetSec = normalizeCameraSyncOffsetMs(cameraSyncOffsetMs) / 1000;
  const label = `[cv${index}]`;

  if (!Number.isFinite(offsetSec) || Math.abs(offsetSec) < 0.0005) {
    return `[${cameraIdx}:v]trim=start=${start.toFixed(3)}:end=${end.toFixed(3)},setpts=PTS-STARTPTS,fps=fps=${targetFps}${label}`;
  }

  const sampleStart = Math.max(0, start + offsetSec);
  const unclampedSampleEnd = Math.max(0, end + offsetSec);
  const sampleEnd = Math.max(sampleStart + 0.001, unclampedSampleEnd);
  const startPad = Math.max(0, -offsetSec);
  const stopPad = Math.max(0, offsetSec);

  return `[${cameraIdx}:v]trim=start=${sampleStart.toFixed(3)}:end=${sampleEnd.toFixed(3)},setpts=PTS-STARTPTS,tpad=start_mode=clone:start_duration=${startPad.toFixed(3)}:stop_mode=clone:stop_duration=${stopPad.toFixed(3)},trim=duration=${duration.toFixed(3)},setpts=PTS-STARTPTS,fps=fps=${targetFps}${label}`;
}

function buildInputPlan(
  sections: RenderSectionInput[],
  takeMap: Map<string, { screenPath: string | null; cameraPath: string | null }>,
  hasCamera: boolean,
) {
  const fpsProbePaths = new Set<string>();
  const sectionInputs: Array<{ screenIdx: number; cameraIdx: number }> = [];
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

    sectionInputs.push(inputPlan);
  }

  return {
    args,
    fpsProbePaths,
    sectionInputs,
  };
}

function buildOutputArgs(targetFps: number, outputPath: string): string[] {
  return [
    '-r',
    String(targetFps),
    '-fps_mode',
    'cfr',
    '-c:v',
    'libx264',
    '-crf',
    '12',
    '-preset',
    'slow',
    '-c:a',
    'aac',
    '-b:a',
    '192k',
    '-y',
    outputPath,
  ];
}

function getTotalDurationSec(sections: RenderSectionInput[]): number {
  return sections.reduce(
    (total, section) => total + Math.max(0, section.sourceEnd - section.sourceStart),
    0,
  );
}

function buildRenderProgressUpdate(
  progress: FfmpegProgress | null,
  totalDurationSec: number,
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
      speed: progress.speed ?? null,
    };
  }

  return {
    phase: 'rendering',
    percent: clampedPercent,
    status:
      clampedPercent === null
        ? 'Rendering...'
        : `Rendering ${Math.round(clampedPercent * 100)}%`,
    outTimeSec: hasOutTime ? outTimeSec : null,
    durationSec: totalDurationSec,
    frame: progress.frame ?? null,
    speed: progress.speed ?? null,
  };
}

export async function renderComposite(
  opts: RenderCompositeOptions = {},
  deps: RenderCompositeDeps = {},
): Promise<string> {
  const takes = Array.isArray(opts.takes) ? opts.takes : [];
  const sections = normalizeSectionInput(opts.sections);
  const keyframes = Array.isArray(opts.keyframes) ? opts.keyframes : [];
  const pipSize = Number.isFinite(Number(opts.pipSize)) ? Number(opts.pipSize) : 422;
  const screenFitMode = opts.screenFitMode === 'fit' ? 'fit' : 'fill';
  const exportAudioPreset = normalizeExportAudioPreset(opts.exportAudioPreset);
  const cameraSyncOffsetMs = normalizeCameraSyncOffsetMs(opts.cameraSyncOffsetMs);
  const sourceWidth = Number.isFinite(Number(opts.sourceWidth)) ? Number(opts.sourceWidth) : 1920;
  const sourceHeight = Number.isFinite(Number(opts.sourceHeight)) ? Number(opts.sourceHeight) : 1080;
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
  const canvasW = 1920;
  const canvasH = 1080;

  const takeMap = new Map<string, { screenPath: string | null; cameraPath: string | null }>();
  for (const take of takes) {
    if (!take || typeof take.id !== 'string' || !take.id) continue;
    takeMap.set(take.id, {
      screenPath: take.screenPath,
      cameraPath: take.cameraPath,
    });
  }

  const hasCamera = keyframes.some(
    (keyframe) => keyframe.pipVisible || keyframe.cameraFullscreen,
  );
  const { args, fpsProbePaths, sectionInputs } = buildInputPlan(
    sections,
    takeMap,
    hasCamera,
  );
  const totalDurationSec = getTotalDurationSec(sections);

  const fpsProbeResults = await Promise.all(
    Array.from(fpsProbePaths).map(async (filePath) => ({
      filePath,
      fps: await probeFps(ffmpegPath, filePath),
    })),
  );

  const targetFps = chooseRenderFps(
    fpsProbeResults.map((result) => result.fps),
    hasCamera,
  );

  console.log(
    '[render-composite] FPS selection:',
    fpsProbeResults.map((result) => ({
      file: path.basename(result.filePath),
      fps: result.fps ? Number(result.fps.toFixed(3)) : null,
    })),
    'targetFps=',
    targetFps,
  );

  const filterParts: string[] = [];
  for (let index = 0; index < sections.length; index += 1) {
    const section = sections[index];
    const { screenIdx } = sectionInputs[index];
    const start = section.sourceStart.toFixed(3);
    const end = section.sourceEnd.toFixed(3);
    filterParts.push(
      `[${screenIdx}:v]trim=start=${start}:end=${end},setpts=PTS-STARTPTS,fps=fps=${targetFps},setsar=1[sv${index}]`,
    );
    filterParts.push(
      `[${screenIdx}:a]atrim=start=${start}:end=${end},asetpts=PTS-STARTPTS[sa${index}]`,
    );
  }

  const screenLabels = sections.map((_, index) => `[sv${index}][sa${index}]`).join('');
  filterParts.push(
    `${screenLabels}concat=n=${sections.length}:v=1:a=1[screen_raw][audio_out]`,
  );
  const exportAudioLabel = buildExportAudioLabel(exportAudioPreset);
  if (exportAudioLabel === 'audio_final') {
    filterParts.push(
      '[audio_out]acompressor=threshold=0.125:ratio=3:attack=20:release=250:makeup=1.5[audio_final]',
    );
  }

  if (hasCamera) {
    for (let index = 0; index < sections.length; index += 1) {
      const section = sections[index];
      const { cameraIdx } = sectionInputs[index];
      const duration = (section.sourceEnd - section.sourceStart).toFixed(3);
      if (cameraIdx >= 0) {
        filterParts.push(
          buildCameraTrimFilter(
            cameraIdx,
            section,
            targetFps,
            index,
            cameraSyncOffsetMs,
          ),
        );
      } else {
        filterParts.push(`color=black:s=1920x1080:d=${duration}[cv${index}]`);
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
      true,
      targetFps,
    );
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
      true,
      targetFps,
    ).replace(/\[0:v\]/g, '[screen_raw]');
    filterParts.push(screenOnlyFilter);
  }

  filterParts.push(`[out]fps=fps=${targetFps}:round=near[out_cfr]`);
  args.push(
    '-filter_complex',
    filterParts.join(';'),
    '-map',
    '[out_cfr]',
    '-map',
    `[${exportAudioLabel}]`,
  );
  args.push(...buildOutputArgs(targetFps, outputPath));

  console.log('ffmpeg args:', args.join(' '));

  if (onProgress) {
    onProgress({
      phase: 'starting',
      percent: 0,
      status: 'Preparing render...',
      durationSec: totalDurationSec,
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
      },
    });
    return outputPath;
  } catch (error) {
    const message = error instanceof Error ? error.message : error;
    console.error('ffmpeg stderr:', message);
    throw error;
  }
}
